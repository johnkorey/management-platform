const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/subscriptions/current - Get current subscription
router.get('/current', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, sp.* FROM subscriptions s
             JOIN subscription_plans sp ON s.plan_id = sp.id
             WHERE s.user_id = $1 AND s.status IN ('trial', 'active')
             ORDER BY s.created_at DESC LIMIT 1`,
            [req.user.id]
        );
        res.json({ success: true, data: result.rows[0] || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching subscription' });
    }
});

// GET /api/subscriptions/plans - List available plans
router.get('/plans', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY price_monthly ASC'
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching plans' });
    }
});

module.exports = router;

