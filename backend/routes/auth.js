// =====================================================
// Authentication Routes
// =====================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const rateLimit = require('express-rate-limit');
const { authenticate, requireAdmin, jwtSecret } = require('../middleware/auth');

// Rate limiting for authentication endpoints
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 attempts per window
    message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Max 3 registrations per hour
    message: { success: false, message: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// =====================================================
// POST /api/auth/register
// Register new user (ADMIN ONLY - Public registration disabled)
// =====================================================

router.post('/register', registerLimiter, authenticate, requireAdmin, async (req, res) => {
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

        // Hash password with bcrypt
        const passwordHash = await bcrypt.hash(password, 12);

        // Generate API key
        const apiKey = crypto.randomBytes(32).toString('hex');

        // Create user
        const userResult = await pool.query(
            `INSERT INTO users (email, username, password_hash, full_name, company_name, api_key)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, username, created_at`,
            [email, username, passwordHash, fullName || null, companyName || null, apiKey]
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

        // Generate JWT using shared secret
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    metadata: {}
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

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' });
        }

        // Get user (including locked accounts)
        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email]
        );

        if (result.rows.length === 0) {
            // Perform dummy bcrypt to prevent timing attacks
            await bcrypt.compare(password, '$2b$12$dummy.hash.to.prevent.timing.attack.xxxxxxxxxxxxxxxxxxxx');
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];
        
        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Account is not active' });
        }
        
        // Parse metadata for lockout info
        let metadata = {};
        if (user.metadata) {
            try {
                metadata = typeof user.metadata === 'string' ? JSON.parse(user.metadata) : user.metadata;
            } catch (e) {
                metadata = {};
            }
        }
        const failedAttempts = metadata.failed_login_attempts || 0;
        const lockedUntil = metadata.account_locked_until ? new Date(metadata.account_locked_until) : null;
        
        // Check if account is locked
        if (lockedUntil && new Date() < lockedUntil) {
            const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
            return res.status(403).json({ 
                success: false, 
                message: `Account temporarily locked. Try again in ${minutesLeft} minutes.` 
            });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);

        if (!isValid) {
            // Increment failed attempts
            const newFailedAttempts = failedAttempts + 1;
            metadata.failed_login_attempts = newFailedAttempts;
            
            // Lock account after 5 failed attempts
            if (newFailedAttempts >= 5) {
                const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
                metadata.account_locked_until = lockUntil.toISOString();
                
                await pool.query(
                    "UPDATE users SET metadata = $1 WHERE id = $2",
                    [JSON.stringify(metadata), user.id]
                );
                
                return res.status(403).json({ 
                    success: false, 
                    message: 'Account locked due to too many failed login attempts. Try again in 30 minutes.' 
                });
            }
            
            // Update failed attempts count
            await pool.query(
                "UPDATE users SET metadata = $1 WHERE id = $2",
                [JSON.stringify(metadata), user.id]
            );
            
            const attemptsLeft = 5 - newFailedAttempts;
            return res.status(401).json({ 
                success: false, 
                message: `Invalid credentials. ${attemptsLeft} attempts remaining before account lockout.` 
            });
        }
        
        // Reset failed attempts on successful login
        metadata.failed_login_attempts = 0;
        metadata.account_locked_until = null;
        await pool.query(
            "UPDATE users SET metadata = $1, last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $2",
            [JSON.stringify(metadata), user.id]
        );

        // Generate JWT using shared secret
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            jwtSecret,
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
                    fullName: user.full_name,
                    metadata: metadata
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

        // Verify using shared secret
        const decoded = jwt.verify(token, jwtSecret);

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

