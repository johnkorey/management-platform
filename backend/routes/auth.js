// =====================================================
// Authentication Routes
// =====================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Get database pool from parent
let pool;
setTimeout(() => { pool = require('../server').pool; }, 100);

// =====================================================
// POST /api/auth/register
// Register new user
// =====================================================

router.post('/register', async (req, res) => {
    try {
        const { email, username, password, fullName, companyName } = req.body;

        // Validation
        if (!email || !username || !password) {
            return res.status(400).json({ success: false, message: 'Email, username, and password required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
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
        const passwordHash = await bcrypt.hash(password, 10);

        // Generate API key
        const apiKey = crypto.randomBytes(32).toString('hex');

        // Create user
        const userResult = await pool.query(
            `INSERT INTO users (email, username, password_hash, full_name, company_name, api_key)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, username, created_at`,
            [email, username, passwordHash, fullName, companyName, apiKey]
        );

        const user = userResult.rows[0];

        // Create unlimited subscription (payment required - no trial)
        const unlimitedPlan = await pool.query(
            "SELECT id FROM subscription_plans WHERE name = 'unlimited' LIMIT 1"
        );

        if (unlimitedPlan.rows.length > 0) {
            // Subscription starts as 'pending' until payment is made
            await pool.query(
                `INSERT INTO subscriptions (user_id, plan_id, status)
                 VALUES ($1, $2, 'pending')`,
                [user.id, unlimitedPlan.rows[0].id]
            );
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username
                },
                token,
                apiKey
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// =====================================================
// POST /api/auth/login
// User login
// =====================================================

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        // Get user
        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND status = $[0~active~]',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Update last login
        await pool.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1',
            [user.id]
        );

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    fullName: user.full_name
                },
                token
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

// =====================================================
// POST /api/auth/verify-token
// Verify JWT token validity
// =====================================================

router.post('/verify-token', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        res.json({
            success: true,
            data: {
                userId: decoded.userId,
                email: decoded.email
            }
        });

    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
});

module.exports = router;

