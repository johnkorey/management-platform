const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/webhooks - List user's webhooks
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM webhooks WHERE user_id = $1',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching webhooks' });
    }
});

// POST /api/webhooks - Create webhook
router.post('/', authenticate, async (req, res) => {
    try {
        const { url, events } = req.body;
        const result = await pool.query(
            `INSERT INTO webhooks (user_id, url, events)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [req.user.id, url, events]
        );
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Webhook creation failed' });
    }
});

module.exports = router;

