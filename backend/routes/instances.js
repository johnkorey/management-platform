const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');
const crypto = require('crypto');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/instances - List user's instances
router.get('/', authenticate, requireSubscription, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM instances WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching instances' });
    }
});

// POST /api/instances - Create new instance
router.post('/', authenticate, requireSubscription, async (req, res) => {
    try {
        const { instanceName, region, baseDomain } = req.body;

        // Check subscription limits
        const instanceCount = await pool.query(
            'SELECT COUNT(*) FROM instances WHERE user_id = $1',
            [req.user.id]
        );

        if (parseInt(instanceCount.rows[0].count) >= req.subscription.max_instances) {
            return res.status(403).json({ 
                success: false, 
                message: `Maximum instances reached for your plan (${req.subscription.max_instances})` 
            });
        }

        // Generate instance API key
        const apiKey = crypto.randomBytes(32).toString('hex');

        // Create instance (in real implementation, this would provision a Docker container/VM)
        const result = await pool.query(
            `INSERT INTO instances (user_id, instance_name, server_ip, api_key, region, base_domain, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'provisioning')
             RETURNING *`,
            [req.user.id, instanceName, '0.0.0.0', apiKey, region, baseDomain]
        );

        res.status(201).json({ 
            success: true, 
            message: 'Instance created (provisioning...)',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Instance creation error:', error);
        res.status(500).json({ success: false, message: 'Failed to create instance' });
    }
});

// POST /api/instances/:id/heartbeat - Instance health check
router.post('/:id/heartbeat', async (req, res) => {
    try {
        const { id } = req.params;
        const { apiKey, resourceUsage, health } = req.body;

        // Verify instance API key
        const result = await pool.query(
            'SELECT id FROM instances WHERE id = $1 AND api_key = $2',
            [id, apiKey]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid instance or API key' });
        }

        // Update heartbeat
        await pool.query(
            `UPDATE instances 
             SET last_heartbeat = CURRENT_TIMESTAMP, resource_usage = $1, health_status = $2
             WHERE id = $3`,
            [JSON.stringify(resourceUsage), health || 'healthy', id]
        );

        res.json({ success: true, message: 'Heartbeat recorded' });

    } catch (error) {
        res.status(500).json({ success: false, message: 'Heartbeat failed' });
    }
});

module.exports = router;

