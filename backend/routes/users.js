const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const pool = require('../db');
const InputSanitizer = require('../utils/sanitizer');  // ✅ SECURITY FIX
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// GET /api/users/me - Get current user profile
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, username, full_name, company_name, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ success: false, message: 'Error fetching user data' });
    }
});

// PUT /api/users/me - Update user profile
router.put('/me', authenticate, async (req, res) => {
    try {
        // ✅ SECURITY FIX: Sanitize all inputs
        const fullName = InputSanitizer.sanitizeString(req.body.fullName, { maxLength: 100 });
        const companyName = InputSanitizer.sanitizeString(req.body.companyName, { maxLength: 100 });
        const phone = InputSanitizer.sanitizePhone(req.body.phone);
        
        // Validate lengths
        if (fullName && fullName.length > 100) {
            return res.status(400).json({ success: false, message: 'Full name too long (max 100 characters)' });
        }
        if (companyName && companyName.length > 100) {
            return res.status(400).json({ success: false, message: 'Company name too long (max 100 characters)' });
        }
        if (phone && phone.length > 20) {
            return res.status(400).json({ success: false, message: 'Phone number too long (max 20 characters)' });
        }
        
        await pool.query(
            'UPDATE users SET full_name = $1, company_name = $2, phone = $3 WHERE id = $4',
            [fullName, companyName, phone, req.user.id]
        );
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ success: false, message: error.message || 'Update failed' });
    }
});

// =====================================================
// ADMIN ONLY - User Management Endpoints
// =====================================================

// GET /api/users - List all users (Admin only)
router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.email, u.username, u.full_name, u.company_name, u.status, u.email_verified, u.created_at, u.last_login,
                   s.plan_id, sp.name as plan_name,
                   (SELECT COUNT(*) FROM instances WHERE user_id = u.id) as vps_count
            FROM users u
            LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
            LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
            ORDER BY u.created_at DESC
        `);
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ success: false, message: 'Failed to list users' });
    }
});

// POST /api/users - Create new user (Admin only)
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { email, username, password, fullName, companyName, emailVerified, status } = req.body;

        // Validation
        if (!email || !username || !password) {
            return res.status(400).json({ success: false, message: 'Email, username, and password required' });
        }

        if (password.length < 12) {
            return res.status(400).json({ success: false, message: 'Password must be at least 12 characters' });
        }

        // Check if user exists
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email, username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email or username already exists' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Generate API key
        const apiKey = crypto.randomBytes(32).toString('hex');

        // Create user - PostgreSQL uses RETURNING instead of separate select
        const userResult = await pool.query(
            `INSERT INTO users (email, username, password_hash, full_name, company_name, api_key, status, email_verified)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, email, username, full_name, status, created_at`,
            [email, username, passwordHash, fullName || null, companyName || null, apiKey, status || 'active', emailVerified || false]
        );
        const user = userResult.rows[0];

        // Create unlimited subscription
        const unlimitedPlan = await pool.query(
            "SELECT id FROM subscription_plans WHERE name = 'unlimited' LIMIT 1"
        );

        if (unlimitedPlan.rows.length > 0) {
            await pool.query(
                `INSERT INTO subscriptions (user_id, plan_id, status)
                 VALUES ($1, $2, 'active')`,
                [user.id, unlimitedPlan.rows[0].id]
            );
        }

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                user: user,
                temporaryPassword: password,  // Send back so admin can share it
                apiKey
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ success: false, message: 'Failed to create user' });
    }
});

// PUT /api/users/:id - Update user (Admin only)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { fullName, companyName, status, emailVerified } = req.body;

        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (fullName !== undefined) {
            updates.push(`full_name = $${paramIndex++}`);
            values.push(InputSanitizer.sanitizeString(fullName, { maxLength: 100 }));
        }
        if (companyName !== undefined) {
            updates.push(`company_name = $${paramIndex++}`);
            values.push(InputSanitizer.sanitizeString(companyName, { maxLength: 100 }));
        }
        if (status !== undefined) {
            if (!['active', 'suspended', 'deleted'].includes(status)) {
                return res.status(400).json({ success: false, message: 'Invalid status' });
            }
            updates.push(`status = $${paramIndex++}`);
            values.push(status);
        }
        if (emailVerified !== undefined) {
            updates.push(`email_verified = $${paramIndex++}`);
            values.push(emailVerified);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(id);
        await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

// DELETE /api/users/:id - Delete user (Admin only)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting own account
        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }

        // Soft delete (set status to deleted) or hard delete
        await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['deleted', id]);

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

// POST /api/users/:id/reset-password - Reset user password (Admin only)
router.post('/:id/reset-password', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Generate random password
        const newPassword = crypto.randomBytes(12).toString('base64').substring(0, 16);
        const passwordHash = await bcrypt.hash(newPassword, 12);

        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);

        res.json({
            success: true,
            message: 'Password reset successfully',
            data: { temporaryPassword: newPassword }
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
});

module.exports = router;
