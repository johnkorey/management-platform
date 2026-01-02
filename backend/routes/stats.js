const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/stats/dashboard - Get dashboard statistics
router.get('/dashboard', authenticate, requireSubscription, async (req, res) => {
    try {
        const stats = await pool.query(
            `SELECT * FROM user_dashboard_stats WHERE user_id = $1`,
            [req.user.id]
        );

        res.json({ success: true, data: stats.rows[0] || {} });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching stats' });
    }
});

module.exports = router;

