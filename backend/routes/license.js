// =====================================================
// License Validation API
// =====================================================
// Validates Evilginx2 instance licenses and enforces VPS limits

const express = require('express');
const router = express.Router();
const pool = require('../db');

// =====================================================
// POST /api/license/validate
// Validate Evilginx2 instance license (called by Evilginx2 on startup)
// =====================================================

router.post('/validate', async (req, res) => {
    try {
        const { user_id, license_key, instance_id, version } = req.body;
        
        if (!user_id || !license_key || !instance_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: user_id, license_key, instance_id' 
            });
        }
        
        // Verify user exists and get license key
        const userResult = await pool.query(
            'SELECT id, api_key, status, email, username FROM users WHERE id = $1',
            [user_id]
        );
        
        if (userResult.rows.length === 0) {
            console.log(`License validation failed: User ${user_id} not found`);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid user ID' 
            });
        }
        
        const user = userResult.rows[0];
        
        // Check if user account is active
        if (user.status !== 'active') {
            console.log(`License validation failed: User ${user.email} account is ${user.status}`);
            return res.status(403).json({ 
                success: false, 
                message: `Account is ${user.status}. Contact administrator.` 
            });
        }
        
        // Verify license key matches (api_key serves as license key)
        if (user.api_key !== license_key) {
            console.log(`License validation failed: Invalid license key for user ${user.email}`);
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid license key' 
            });
        }
        
        // Check if this instance belongs to this user
        const instanceResult = await pool.query(
            'SELECT id, instance_name, status FROM instances WHERE id = $1 AND user_id = $2',
            [instance_id, user_id]
        );
        
        if (instanceResult.rows.length === 0) {
            console.log(`License validation failed: Instance ${instance_id} not found for user ${user.email}`);
            return res.status(403).json({ 
                success: false, 
                message: 'Instance not registered to this user' 
            });
        }
        
        const instance = instanceResult.rows[0];
        
        // Count total active instances for this user
        const countResult = await pool.query(
            `SELECT COUNT(*) as count FROM instances 
             WHERE user_id = $1 AND status IN ('running', 'provisioning') AND id != $2`,
            [user_id, instance_id]
        );
        
        const activeCount = parseInt(countResult.rows[0].count);
        
        // Enforce 2 VPS limit
        const MAX_INSTANCES = 2;
        if (activeCount >= MAX_INSTANCES) {
            console.log(`License validation failed: User ${user.email} has ${activeCount} instances (limit: ${MAX_INSTANCES})`);
            return res.status(403).json({ 
                success: false, 
                message: `License limit exceeded: Maximum ${MAX_INSTANCES} VPS instances allowed. Currently active: ${activeCount}` 
            });
        }
        
        // Update instance heartbeat and status
        await pool.query(
            `UPDATE instances 
             SET last_heartbeat = NOW(), 
                 status = 'running',
                 version = $1
             WHERE id = $2`,
            [version || null, instance_id]
        );
        
        console.log(`✅ License validated: User ${user.email} (${user.username}), Instance ${instance.instance_name}, Active: ${activeCount + 1}/${MAX_INSTANCES}`);
        
        res.json({
            success: true,
            message: 'License valid',
            data: {
                user_id: user.id,
                username: user.username,
                email: user.email,
                instance_id: instance_id,
                instance_name: instance.instance_name,
                max_instances: MAX_INSTANCES,
                active_instances: activeCount + 1,
                licensed: true,
                expires_at: null  // Unlimited subscription
            }
        });
        
    } catch (error) {
        console.error('License validation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'License validation service error' 
        });
    }
});

// =====================================================
// POST /api/license/heartbeat
// Instance heartbeat (called periodically by Evilginx2)
// =====================================================

router.post('/heartbeat', async (req, res) => {
    try {
        const { instance_id, license_key, stats } = req.body;
        
        if (!instance_id || !license_key) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        // Verify instance and license
        const result = await pool.query(
            `SELECT i.*, u.api_key, u.status as user_status 
             FROM instances i
             JOIN users u ON i.user_id = u.id
             WHERE i.id = $1`,
            [instance_id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Instance not found' });
        }
        
        const instance = result.rows[0];
        
        // Verify license key
        if (instance.api_key !== license_key) {
            return res.status(401).json({ success: false, message: 'Invalid license key' });
        }
        
        // Check user status
        if (instance.user_status !== 'active') {
            return res.status(403).json({ success: false, message: 'User account not active' });
        }
        
        // Update heartbeat and stats
        await pool.query(
            `UPDATE instances 
             SET last_heartbeat = NOW(),
                 health_status = 'healthy',
                 resource_usage = $1
             WHERE id = $2`,
            [JSON.stringify(stats || {}), instance_id]
        );
        
        res.json({ success: true, message: 'Heartbeat recorded', licensed: true });
        
    } catch (error) {
        console.error('Heartbeat error:', error);
        res.status(500).json({ success: false, message: 'Heartbeat failed' });
    }
});

// =====================================================
// GET /api/license/info/:instanceId
// Get license info for an instance (authenticated users only)
// =====================================================

const { authenticate } = require('../middleware/auth');

router.get('/info/:instanceId', authenticate, async (req, res) => {
    try {
        const { instanceId } = req.params;
        const isAdmin = req.user.metadata?.role === 'admin';
        
        // Verify user owns this instance or is admin
        const result = await pool.query(
            `SELECT i.*, u.username, u.email 
             FROM instances i
             JOIN users u ON i.user_id = u.id
             WHERE i.id = $1 AND (i.user_id = $2 OR $3 = true)`,
            [instanceId, req.user.id, isAdmin]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Instance not found' });
        }
        
        const instance = result.rows[0];
        
        // Count user's active instances
        const countResult = await pool.query(
            "SELECT COUNT(*) as count FROM instances WHERE user_id = $1 AND status = 'running'",
            [instance.user_id]
        );
        
        res.json({
            success: true,
            data: {
                instance_id: instance.id,
                instance_name: instance.instance_name,
                user_email: instance.email,
                status: instance.status,
                max_instances: 2,
                active_instances: parseInt(countResult.rows[0].count),
                last_heartbeat: instance.last_heartbeat,
                health_status: instance.health_status
            }
        });
        
    } catch (error) {
        console.error('Get license info error:', error);
        res.status(500).json({ success: false, message: 'Failed to get license info' });
    }
});

module.exports = router;
