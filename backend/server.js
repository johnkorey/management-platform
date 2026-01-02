// =====================================================
// Evilginx Management Platform - Backend API Server
// =====================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// DATABASE CONNECTION (SQLite)
// =====================================================

const pool = require('./db');

// =====================================================
// MIDDLEWARE
// =====================================================

// ✅ SECURITY FIX: Enhanced security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    hsts: {
        maxAge: 31536000,  // 1 year
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny'
    },
    noSniff: true,
    xssFilter: true,
}));

// ✅ SECURITY FIX: Dynamic CORS configuration
const allowedOrigins = process.env.CORS_ORIGINS ? 
    process.env.CORS_ORIGINS.split(',') : 
    ['http://localhost:3001', 'http://127.0.0.1:3001'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        // Check if origin is allowed
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else if (process.env.NODE_ENV === 'development' && 
                   (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    maxAge: 86400  // Cache preflight for 24 hours
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// ✅ SECURITY FIX: Reduced body size limits
app.use(express.json({ limit: '100kb' }));  // Reduced from 10mb
app.use(express.urlencoded({ extended: false, limit: '50kb' }));  // Reduced, changed to false

// ✅ SECURITY FIX: Add request timeout
app.use((req, res, next) => {
    req.setTimeout(30000);  // 30 seconds
    res.setTimeout(30000);
    next();
});

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// =====================================================
// ROUTES
// =====================================================

// Import route modules
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const subscriptionRoutes = require('./routes/subscriptions');
const instanceRoutes = require('./routes/instances');
const sessionRoutes = require('./routes/sessions');
const billingRoutes = require('./routes/billing');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const vpsRoutes = require('./routes/vps');
const githubWebhookRoutes = require('./routes/github-webhook');
const licenseRoutes = require('./routes/license');  // ✅ NEW: License validation
const evilginxProxyRoutes = require('./routes/evilginx-proxy');  // ✅ NEW: Evilginx2 API proxy

// Health check endpoints
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: 'connected'
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: 'connected',
        version: '1.0.0'
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/vps', vpsRoutes);
app.use('/api/github', githubWebhookRoutes);
app.use('/api/license', licenseRoutes);  // ✅ NEW: License validation
app.use('/api/evilginx', evilginxProxyRoutes);  // ✅ NEW: Evilginx2 API proxy

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ===============================================');
    console.log('🎯 Evilginx Management Platform API Server');
    console.log('🚀 ===============================================');
    console.log(`📡 Server running on: http://localhost:${PORT}`);
    console.log(`🗄️  Database: ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log('🚀 ===============================================');
    console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    pool.end(() => {
        console.log('Database pool closed');
        process.exit(0);
    });
});

// Export for testing
module.exports = { app, pool };



