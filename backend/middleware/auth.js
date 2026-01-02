// =====================================================
// Authentication Middleware
// =====================================================

const jwt = require('jsonwebtoken');
const { pool } = require('../server');

// Verify JWT token
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user from database
        const result = await pool.query(
            'SELECT id, email, username, status FROM users WHERE id = $1',
            [decoded.userId]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        const user = result.rows[0];

        if (user.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Account suspended or deleted' });
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
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
};

// Check if user has active subscription
const requireSubscription = async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT s.*, sp.name as plan_name, sp.features 
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

        req.subscription = result.rows[0];
        next();
    } catch (error) {
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
        // Check if user email is admin email or has admin role
        const result = await pool.query(
            `SELECT metadata->>'role' as role FROM users WHERE id = $1`,
            [req.user.id]
        );

        const role = result.rows[0]?.role;
        
        if (role !== 'admin' && req.user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }

        next();
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Authorization error' });
    }
};

module.exports = {
    authenticate,
    requireSubscription,
    requireFeature,
    requireAdmin
};

