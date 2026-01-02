const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const pool = require('../db');

// GET /api/subscriptions/current - Get current subscription
router.get('/current', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, sp.name as plan_name, sp.display_name, sp.price_monthly, sp.max_instances, sp.features 
             FROM subscriptions s
             JOIN subscription_plans sp ON s.plan_id = sp.id
             WHERE s.user_id = $1 AND s.status IN ('pending', 'active')
             ORDER BY s.created_at DESC LIMIT 1`,
            [req.user.id]
        );
        
        let subscription = result.rows[0] || null;
        if (subscription && typeof subscription.features === 'string') {
            subscription.features = JSON.parse(subscription.features);
        }
        
        res.json({ success: true, data: subscription });
    } catch (error) {
        console.error('Error fetching subscription:', error);
        res.status(500).json({ success: false, message: 'Error fetching subscription' });
    }
});

// GET /api/subscriptions/plans - List available plans
router.get('/plans', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price_monthly ASC'
        );
        
        // Parse features JSON
        const plans = result.rows.map(plan => ({
            ...plan,
            features: typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features
        }));
        
        res.json({ success: true, data: plans });
    } catch (error) {
        console.error('Error fetching plans:', error);
        res.status(500).json({ success: false, message: 'Error fetching plans' });
    }
});

module.exports = router;
