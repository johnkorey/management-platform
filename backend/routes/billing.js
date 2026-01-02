const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/billing/payments - Get payment history
router.get('/payments', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching payments' });
    }
});

// POST /api/billing/create-checkout - Create Stripe checkout session (placeholder)
router.post('/create-checkout', authenticate, async (req, res) => {
    try {
        // TODO: Implement Stripe checkout session creation
        res.json({ success: true, message: 'Stripe integration pending' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Checkout creation failed' });
    }
});

module.exports = router;

