const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/users/me - Get current user profile
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, username, full_name, company_name, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching user data' });
    }
});

// PUT /api/users/me - Update user profile
router.put('/me', authenticate, async (req, res) => {
    try {
        const { fullName, companyName, phone } = req.body;
        await pool.query(
            'UPDATE users SET full_name = $1, company_name = $2, phone = $3 WHERE id = $4',
            [fullName, companyName, phone, req.user.id]
        );
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed' });
    }
});

module.exports = router;

