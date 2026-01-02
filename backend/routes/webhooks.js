const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');
const pool = require('../db');

// GET /api/webhooks - List user's webhooks
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM webhooks WHERE user_id = $1',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching webhooks:', error);
        res.status(500).json({ success: false, message: 'Error fetching webhooks' });
    }
});

// POST /api/webhooks - Create webhook
router.post('/', authenticate, async (req, res) => {
    try {
        const { url, events } = req.body;
        const webhookId = crypto.randomBytes(16).toString('hex');
        const secret = crypto.randomBytes(32).toString('hex');
        
        await pool.query(
            `INSERT INTO webhooks (id, user_id, url, events, secret)
             VALUES ($1, $2, $3, $4, $5)`,
            [webhookId, req.user.id, url, JSON.stringify(events), secret]
        );

        const result = await pool.query('SELECT * FROM webhooks WHERE id = $1', [webhookId]);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Webhook creation error:', error);
        res.status(500).json({ success: false, message: 'Webhook creation failed' });
    }
});

module.exports = router;
