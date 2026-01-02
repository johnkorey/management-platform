// =====================================================
// GitHub Webhook Handler - Auto-update on Push
// =====================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const SSHService = require('../services/ssh');

const sshService = new SSHService(pool);

// =====================================================
// WEBHOOK SIGNATURE VERIFICATION
// =====================================================

const verifyGitHubSignature = async (req, res, next) => {
    try {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            console.log('No GitHub signature found');
            return res.status(401).json({ error: 'No signature' });
        }

        // Get secret from database
        const result = await pool.query('SELECT secret FROM github_webhook_settings LIMIT 1');
        if (result.rows.length === 0) {
            return res.status(500).json({ error: 'Webhook not configured' });
        }

        const secret = result.rows[0].secret;
        const payload = JSON.stringify(req.body);
        const expectedSignature = 'sha256=' + crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            console.log('Invalid GitHub signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        next();
    } catch (error) {
        console.error('Signature verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
};

// =====================================================
// WEBHOOK ENDPOINTS
// =====================================================

// POST /api/github/webhook - Receive GitHub push events
router.post('/webhook', express.json(), verifyGitHubSignature, async (req, res) => {
    try {
        const event = req.headers['x-github-event'];
        const payload = req.body;

        console.log(`📦 Received GitHub ${event} event`);

        // Only handle push events
        if (event !== 'push') {
            return res.json({ message: `Event ${event} ignored` });
        }

        // Get the branch that was pushed
        const branch = payload.ref?.replace('refs/heads/', '');
        const commit = payload.after?.substring(0, 7);
        const pusher = payload.pusher?.name;
        const repoUrl = payload.repository?.clone_url;

        console.log(`🔄 Push to branch ${branch} by ${pusher} (commit: ${commit})`);

        // Check if auto-update is enabled
        const settingsResult = await pool.query(
            'SELECT auto_update FROM github_webhook_settings LIMIT 1'
        );
        
        if (!settingsResult.rows[0]?.auto_update) {
            console.log('Auto-update is disabled');
            return res.json({ message: 'Auto-update disabled' });
        }

        // Get all deployed VPS instances matching this branch
        const vpsResult = await pool.query(`
            SELECT v.* FROM vps_instances v
            WHERE v.is_deployed = true 
            AND v.github_branch = $1
            AND v.status NOT IN ('deploying', 'error')
        `, [branch]);

        if (vpsResult.rows.length === 0) {
            console.log(`No VPS instances configured for branch ${branch}`);
            return res.json({ message: 'No matching VPS instances' });
        }

        console.log(`🚀 Triggering auto-update for ${vpsResult.rows.length} VPS instance(s)`);

        // Create deployments and trigger updates
        const updates = [];
        for (const vps of vpsResult.rows) {
            try {
                const deployId = crypto.randomBytes(16).toString('hex');
                
                // Create deployment record
                await pool.query(`
                    INSERT INTO deployments (id, vps_id, user_id, type, from_version, triggered_by)
                    VALUES ($1, $2, $3, 'update', $4, 'webhook')
                `, [deployId, vps.id, vps.user_id, vps.deployed_version]);

                // Start deployment (non-blocking)
                sshService.deploy(vps.id, deployId).then(() => {
                    console.log(`✅ Auto-update completed for VPS ${vps.name}`);
                }).catch(err => {
                    console.error(`❌ Auto-update failed for VPS ${vps.name}:`, err.message);
                });

                updates.push({
                    vps_id: vps.id,
                    vps_name: vps.name,
                    deployment_id: deployId
                });
            } catch (error) {
                console.error(`Failed to create deployment for VPS ${vps.id}:`, error);
            }
        }

        res.json({
            success: true,
            message: `Auto-update triggered for ${updates.length} VPS instance(s)`,
            data: {
                branch,
                commit,
                updates
            }
        });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// =====================================================
// WEBHOOK SETTINGS (Admin endpoints)
// =====================================================

const { authenticate, requireAdmin } = require('../middleware/auth');

// ✅ SECURITY FIX: GET /api/github/settings - Get webhook settings (ADMIN ONLY)
router.get('/settings', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM github_webhook_settings LIMIT 1');
        
        if (result.rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Get webhook settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to get settings' });
    }
});

// ✅ SECURITY FIX: PUT /api/github/settings - Update webhook settings (ADMIN ONLY)
router.put('/settings', authenticate, requireAdmin, async (req, res) => {
    try {
        const { repo_url, branch, auto_update, docker_image } = req.body;

        // Check if settings exist
        const existing = await pool.query('SELECT id FROM github_webhook_settings LIMIT 1');
        
        if (existing.rows.length === 0) {
            // Create new settings
            const settingsId = crypto.randomBytes(16).toString('hex');
            const secret = crypto.randomBytes(32).toString('hex');
            await pool.query(`
                INSERT INTO github_webhook_settings (id, repo_url, branch, auto_update, secret, docker_image)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [settingsId, repo_url, branch || 'main', auto_update ? true : false, secret, docker_image || null]);
        } else {
            // Update existing
            await pool.query(`
                UPDATE github_webhook_settings 
                SET repo_url = $1, branch = $2, auto_update = $3, docker_image = $4, updated_at = NOW()
                WHERE id = $5
            `, [repo_url, branch, auto_update ? true : false, docker_image || null, existing.rows[0].id]);
        }

        const result = await pool.query('SELECT * FROM github_webhook_settings LIMIT 1');
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Update webhook settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
});

// ✅ SECURITY FIX: POST /api/github/regenerate-secret - Generate new webhook secret (ADMIN ONLY)
router.post('/regenerate-secret', authenticate, requireAdmin, async (req, res) => {
    try {
        const newSecret = crypto.randomBytes(32).toString('hex');
        
        // Check if settings exist
        const existing = await pool.query('SELECT id FROM github_webhook_settings LIMIT 1');
        
        if (existing.rows.length === 0) {
            const settingsId = crypto.randomBytes(16).toString('hex');
            await pool.query(`
                INSERT INTO github_webhook_settings (id, secret)
                VALUES ($1, $2)
            `, [settingsId, newSecret]);
        } else {
            await pool.query(
                'UPDATE github_webhook_settings SET secret = $1 WHERE id = $2',
                [newSecret, existing.rows[0].id]
            );
        }

        res.json({ 
            success: true, 
            data: { 
                secret: newSecret,
                message: 'Remember to update this in your GitHub webhook settings!' 
            } 
        });
    } catch (error) {
        console.error('Regenerate secret error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate secret' });
    }
});

// ✅ SECURITY FIX: POST /api/github/test-update - Manually trigger update for all VPS (ADMIN ONLY)
router.post('/test-update', authenticate, requireAdmin, async (req, res) => {
    try {
        const updates = await sshService.updateAllVPS();
        
        res.json({
            success: true,
            message: `Update triggered for ${updates.length} VPS instance(s)`,
            data: updates
        });
    } catch (error) {
        console.error('Test update error:', error);
        res.status(500).json({ success: false, message: 'Failed to trigger updates' });
    }
});

module.exports = router;
