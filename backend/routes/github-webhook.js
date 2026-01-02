// =====================================================
// GitHub Webhook Handler - Auto-update on Push
// =====================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Pool } = require('pg');
const SSHService = require('../services/ssh');

// Database pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

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
        const result = await pool.query('SELECT secret_token FROM github_webhook_settings LIMIT 1');
        if (result.rows.length === 0) {
            return res.status(500).json({ error: 'Webhook not configured' });
        }

        const secret = result.rows[0].secret_token;
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

        // Update webhook settings
        await pool.query(`
            UPDATE github_webhook_settings 
            SET last_push_at = NOW(), last_push_commit = $1 
            WHERE repo_url = $2 OR $2 IS NULL
        `, [payload.after, repoUrl]);

        // Check if auto-update is enabled
        const settingsResult = await pool.query(
            'SELECT auto_update_enabled FROM github_webhook_settings LIMIT 1'
        );
        
        if (!settingsResult.rows[0]?.auto_update_enabled) {
            console.log('Auto-update is disabled');
            return res.json({ message: 'Auto-update disabled' });
        }

        // Get all deployed VPS instances matching this branch
        const vpsResult = await pool.query(`
            SELECT v.* FROM vps_instances v
            WHERE v.is_deployed = TRUE 
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
                // Create deployment record
                const deployResult = await pool.query(`
                    INSERT INTO deployments (vps_id, user_id, type, from_version, triggered_by, git_commit)
                    VALUES ($1, $2, 'update', $3, 'webhook', $4)
                    RETURNING id
                `, [vps.id, vps.user_id, vps.deployed_version, payload.after]);

                const deploymentId = deployResult.rows[0].id;

                // Start deployment (non-blocking)
                sshService.deploy(vps.id, deploymentId).then(() => {
                    console.log(`✅ Auto-update completed for VPS ${vps.name}`);
                }).catch(err => {
                    console.error(`❌ Auto-update failed for VPS ${vps.name}:`, err.message);
                });

                updates.push({
                    vps_id: vps.id,
                    vps_name: vps.name,
                    deployment_id: deploymentId
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

const { authenticateToken } = require('../middleware/auth');

// GET /api/github/settings - Get webhook settings
router.get('/settings', authenticateToken, async (req, res) => {
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

// PUT /api/github/settings - Update webhook settings
router.put('/settings', authenticateToken, async (req, res) => {
    try {
        const { repo_url, branch, auto_update_enabled } = req.body;

        const result = await pool.query(`
            UPDATE github_webhook_settings 
            SET 
                repo_url = COALESCE($1, repo_url),
                branch = COALESCE($2, branch),
                auto_update_enabled = COALESCE($3, auto_update_enabled)
            RETURNING *
        `, [repo_url, branch, auto_update_enabled]);

        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Update webhook settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
});

// POST /api/github/regenerate-secret - Generate new webhook secret
router.post('/regenerate-secret', authenticateToken, async (req, res) => {
    try {
        const newSecret = crypto.randomBytes(32).toString('hex');
        
        await pool.query(
            'UPDATE github_webhook_settings SET secret_token = $1',
            [newSecret]
        );

        res.json({ 
            success: true, 
            data: { 
                secret_token: newSecret,
                message: 'Remember to update this in your GitHub webhook settings!' 
            } 
        });
    } catch (error) {
        console.error('Regenerate secret error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate secret' });
    }
});

// POST /api/github/test-update - Manually trigger update for all VPS
router.post('/test-update', authenticateToken, async (req, res) => {
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

