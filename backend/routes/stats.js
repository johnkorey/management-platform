const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');
const pool = require('../db');

// GET /api/stats/dashboard - Get dashboard statistics
router.get('/dashboard', authenticate, requireSubscription, async (req, res) => {
    try {
        // Get instance count
        const instancesResult = await pool.query(
            'SELECT COUNT(*) as count FROM instances WHERE user_id = $1',
            [req.user.id]
        );

        // Get sessions count
        const sessionsResult = await pool.query(
            'SELECT COUNT(*) as count FROM sessions WHERE user_id = $1',
            [req.user.id]
        );

        // Get VPS count
        const vpsResult = await pool.query(
            'SELECT COUNT(*) as count FROM vps_instances WHERE user_id = $1',
            [req.user.id]
        );

        // Get monthly usage
        const now = new Date();
        const usageResult = await pool.query(
            `SELECT COALESCE(SUM(total_sessions), 0) as monthly_sessions
             FROM usage_stats 
             WHERE user_id = $1 AND period_month = $2 AND period_year = $3`,
            [req.user.id, now.getMonth() + 1, now.getFullYear()]
        );

        const stats = {
            total_instances: parseInt(instancesResult.rows[0]?.count || 0),
            total_sessions: parseInt(sessionsResult.rows[0]?.count || 0),
            total_vps: parseInt(vpsResult.rows[0]?.count || 0),
            monthly_sessions: parseInt(usageResult.rows[0]?.monthly_sessions || 0),
            subscription_status: req.subscription?.status || 'none',
            plan_name: req.subscription?.plan_name || 'None'
        };

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ success: false, message: 'Error fetching stats' });
    }
});

module.exports = router;
