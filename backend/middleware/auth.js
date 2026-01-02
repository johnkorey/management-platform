// =====================================================
// Authentication Middleware
// =====================================================

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

// Generate JWT secret if not set (for initial deployment)
// In production, always set JWT_SECRET environment variable!
let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret === 'default_secret_change_me') {
    if (process.env.NODE_ENV === 'production') {
        console.error('⚠️  WARNING: JWT_SECRET not set in production!');
        console.error('⚠️  Generating a random secret for this session.');
        console.error('⚠️  Set JWT_SECRET environment variable for persistence across restarts.');
    }
    // Generate a random secret for this session
    jwtSecret = crypto.randomBytes(64).toString('hex');
    console.log('🔐 Using auto-generated JWT secret');
}

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const decoded = jwt.verify(token, jwtSecret);
        
        // Get user from database
        const result = await pool.query(
            'SELECT id, email, username, status, metadata FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        const user = result.rows[0];

        if (user.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Account suspended or deleted' });
        }

        // Parse metadata if string
        if (typeof user.metadata === 'string') {
            try {
                user.metadata = JSON.parse(user.metadata);
            } catch (e) {
                user.metadata = {};
            }
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired' });
        }
        console.error('Auth error:', error);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
};

// Check if user has active subscription
const requireSubscription = async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT s.*, sp.name as plan_name, sp.features, sp.max_instances
             FROM subscriptions s
             JOIN subscription_plans sp ON s.plan_id = sp.id
             WHERE s.user_id = $1 AND s.status IN ('pending', 'active')
             ORDER BY s.created_at DESC
             LIMIT 1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'No active subscription found' 
            });
        }

        const subscription = result.rows[0];
        // Parse features if it's a string
        if (typeof subscription.features === 'string') {
            try {
                subscription.features = JSON.parse(subscription.features);
            } catch (e) {
                subscription.features = {};
            }
        }
        req.subscription = subscription;
        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        return res.status(500).json({ success: false, message: 'Subscription check error' });
    }
};

// Check if user has specific feature access
const requireFeature = (featureName) => {
    return (req, res, next) => {
        if (!req.subscription) {
            return res.status(403).json({ success: false, message: 'No subscription found' });
        }

        const features = req.subscription.features || {};
        
        if (!features[featureName]) {
            return res.status(403).json({ 
                success: false, 
                message: `This feature requires a plan with ${featureName} access` 
            });
        }

        next();
    };
};

// Admin only middleware
const requireAdmin = async (req, res, next) => {
    try {
        // Check if user already has metadata attached
        let metadata = req.user.metadata;
        
        // If not, fetch from database
        if (!metadata) {
            const result = await pool.query(
                `SELECT metadata FROM users WHERE id = $1`,
                [req.user.id]
            );
            metadata = result.rows[0]?.metadata;
        }

        if (typeof metadata === 'string') {
            try {
                metadata = JSON.parse(metadata);
            } catch (e) {
                metadata = {};
            }
        }
        const role = metadata?.role;
        
        if (role !== 'admin' && req.user.email !== 'admin@evilginx.local') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        next();
    } catch (error) {
        console.error('Admin check error:', error);
        return res.status(500).json({ success: false, message: 'Authorization error' });
    }
};

// Export jwtSecret for use in auth routes (login/register)
module.exports = {
    authenticate,
    requireSubscription,
    requireFeature,
    requireAdmin,
    jwtSecret
};

