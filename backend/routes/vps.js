// =====================================================
// VPS Management Routes
// =====================================================

const express = require('express');
const router = express.Router();
const { authenticate, requireSubscription } = require('../middleware/auth');
const SSHService = require('../services/ssh');
const crypto = require('crypto');
const pool = require('../db');

const sshService = new SSHService(pool);

// =====================================================
// MIDDLEWARE
// =====================================================

// Check VPS ownership
const checkVPSOwnership = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await pool.query(
            'SELECT * FROM vps_instances WHERE id = $1 AND user_id = $2',
            [id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'VPS not found' });
        }

        req.vps = result.rows[0];
        next();
    } catch (error) {
        console.error('VPS ownership check error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// =====================================================
// CRUD OPERATIONS
// =====================================================

// GET /api/vps - List user's VPS instances
router.get('/', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.*,
                (SELECT COUNT(*) FROM deployments d WHERE d.vps_id = v.id) as deployment_count
            FROM vps_instances v
            WHERE v.user_id = $1
            ORDER BY v.created_at DESC
        `, [req.user.id]);

        // Don't return encrypted credentials or sensitive settings
        // GitHub repo URL is admin-only information
        const isAdmin = req.user.metadata?.role === 'admin' || req.user.email === 'admin@evilginx.local';
        const vpsList = result.rows.map(vps => ({
            ...vps,
            password_encrypted: undefined,
            ssh_key_encrypted: undefined,
            has_password: !!vps.password_encrypted,
            has_ssh_key: !!vps.ssh_key_encrypted,
            // Hide GitHub settings from non-admin users
            github_repo: isAdmin ? vps.github_repo : undefined,
            github_branch: isAdmin ? vps.github_branch : undefined
        }));

        res.json({ success: true, data: vpsList });
    } catch (error) {
        console.error('List VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to list VPS instances' });
    }
});

// GET /api/vps/:id - Get VPS details
router.get('/:id', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const isAdmin = req.user.metadata?.role === 'admin' || req.user.email === 'admin@evilginx.local';
        const vps = {
            ...req.vps,
            password_encrypted: undefined,
            ssh_key_encrypted: undefined,
            has_password: !!req.vps.password_encrypted,
            has_ssh_key: !!req.vps.ssh_key_encrypted,
            // Hide GitHub settings from non-admin users
            github_repo: isAdmin ? req.vps.github_repo : undefined,
            github_branch: isAdmin ? req.vps.github_branch : undefined
        };

        res.json({ success: true, data: vps });
    } catch (error) {
        console.error('Get VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to get VPS details' });
    }
});

// POST /api/vps - Add new VPS (max 2 per user)
router.post('/', authenticate, requireSubscription, async (req, res) => {
    try {
        const { name, description, host, port, username, auth_type, password, ssh_key, install_path } = req.body;
        // ✅ SECURITY: GitHub repo settings are admin-only - users cannot specify repo URL
        // Deployment will use admin-configured settings from github_webhook_settings table

        // Validate required fields
        if (!name || !host || !username) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, host, and username are required' 
            });
        }

        // Check max VPS limit (2 per user)
        const countResult = await pool.query(
            'SELECT COUNT(*) as count FROM vps_instances WHERE user_id = $1',
            [req.user.id]
        );
        if (parseInt(countResult.rows[0].count) >= 2) {
            return res.status(400).json({ 
                success: false, 
                message: 'Maximum 2 VPS instances allowed. Please remove one before adding another.' 
            });
        }

        // Encrypt credentials
        let passwordEncrypted = null;
        let sshKeyEncrypted = null;

        if (auth_type === 'key' && ssh_key) {
            sshKeyEncrypted = sshService.encryptCredential(ssh_key);
        } else if (password) {
            passwordEncrypted = sshService.encryptCredential(password);
        }

        // Insert VPS
        const insertResult = await pool.query(`
            INSERT INTO vps_instances (
                user_id, name, description, host, port, username, 
                auth_type, password_encrypted, ssh_key_encrypted,
                github_repo, github_branch, install_path, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
            RETURNING *
        `, [
            req.user.id, name, description || null, host, port || 22, username,
            auth_type || 'password', passwordEncrypted, sshKeyEncrypted,
            null,  // github_repo - uses admin settings
            null,  // github_branch - uses admin settings
            install_path || '/opt/evilginx'
        ]);

        const vps = insertResult.rows[0];

        // Test connection
        const testResult = await sshService.testConnection({
            host,
            port: port || 22,
            username,
            auth_type: auth_type || 'password',
            password_encrypted: passwordEncrypted,
            ssh_key_encrypted: sshKeyEncrypted
        });

        if (testResult.success) {
            await pool.query(
                'UPDATE vps_instances SET status = $1 WHERE id = $2',
                ['connected', vps.id]
            );
            vps.status = 'connected';
        } else {
            await pool.query(
                'UPDATE vps_instances SET status = $1, last_error = $2 WHERE id = $3',
                ['error', testResult.error, vps.id]
            );
            vps.status = 'error';
            vps.last_error = testResult.error;
        }

        res.status(201).json({
            success: true,
            data: {
                ...vps,
                password_encrypted: undefined,
                ssh_key_encrypted: undefined,
                connection_test: testResult
            }
        });
    } catch (error) {
        console.error('Create VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to add VPS' });
    }
});

// PUT /api/vps/:id - Update VPS details
router.put('/:id', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const { name, description, host, port, username, auth_type, password, ssh_key, install_path } = req.body;
        // ✅ SECURITY: github_repo and github_branch are admin-only - not allowed in updates

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (name) { updates.push(`name = $${paramIndex++}`); values.push(name); }
        if (description !== undefined) { updates.push(`description = $${paramIndex++}`); values.push(description); }
        if (host) { updates.push(`host = $${paramIndex++}`); values.push(host); }
        if (port) { updates.push(`port = $${paramIndex++}`); values.push(port); }
        if (username) { updates.push(`username = $${paramIndex++}`); values.push(username); }
        if (auth_type) { updates.push(`auth_type = $${paramIndex++}`); values.push(auth_type); }
        // ✅ SECURITY: GitHub settings removed - admin configures globally
        if (install_path) { updates.push(`install_path = $${paramIndex++}`); values.push(install_path); }

        // Handle credential updates
        if (password) {
            updates.push(`password_encrypted = $${paramIndex++}`);
            values.push(sshService.encryptCredential(password));
        }
        if (ssh_key) {
            updates.push(`ssh_key_encrypted = $${paramIndex++}`);
            values.push(sshService.encryptCredential(ssh_key));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(req.params.id);
        await pool.query(
            `UPDATE vps_instances SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
            values
        );

        const result = await pool.query('SELECT * FROM vps_instances WHERE id = $1', [req.params.id]);

        res.json({
            success: true,
            data: {
                ...result.rows[0],
                password_encrypted: undefined,
                ssh_key_encrypted: undefined
            }
        });
    } catch (error) {
        console.error('Update VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to update VPS' });
    }
});

// DELETE /api/vps/:id - Remove VPS
router.delete('/:id', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        // Disconnect SSH
        sshService.disconnect(req.params.id);

        // Delete from database (cascades to deployments)
        await pool.query('DELETE FROM vps_instances WHERE id = $1', [req.params.id]);

        res.json({ success: true, message: 'VPS removed successfully' });
    } catch (error) {
        console.error('Delete VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete VPS' });
    }
});

// =====================================================
// CONNECTION & STATUS
// =====================================================

// POST /api/vps/:id/test-connection - Test SSH connection
router.post('/:id/test-connection', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const result = await sshService.testConnection(req.vps);
        
        if (result.success) {
            await pool.query(
                'UPDATE vps_instances SET status = $1, last_error = NULL WHERE id = $2',
                ['connected', req.params.id]
            );
        } else {
            await pool.query(
                'UPDATE vps_instances SET status = $1, last_error = $2 WHERE id = $3',
                ['error', result.error, req.params.id]
            );
        }

        res.json({ success: result.success, data: result });
    } catch (error) {
        console.error('Test connection error:', error);
        res.status(500).json({ success: false, message: 'Connection test failed' });
    }
});

// GET /api/vps/:id/status - Get current status
router.get('/:id/status', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const status = await sshService.getServiceStatus(req.params.id);
        res.json({ success: true, data: status });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ success: false, message: 'Failed to get status' });
    }
});

// GET /api/vps/:id/system-info - Get system information
router.get('/:id/system-info', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const info = await sshService.getSystemInfo(req.params.id);
        
        // Update in database
        await pool.query(
            'UPDATE vps_instances SET system_info = $1 WHERE id = $2',
            [JSON.stringify(info), req.params.id]
        );

        res.json({ success: true, data: info });
    } catch (error) {
        console.error('Get system info error:', error);
        res.status(500).json({ success: false, message: 'Failed to get system info' });
    }
});

// GET /api/vps/:id/admin-access - Get admin dashboard access info (API key & URL)
router.get('/:id/admin-access', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT host, install_path, admin_api_key, is_deployed FROM vps_instances WHERE id = $1', 
            [req.params.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: 'VPS not found' });
        }
        
        const vps = result.rows[0];
        
        // Check if deployed
        if (!vps.is_deployed || !vps.admin_api_key) {
            return res.json({
                success: true,
                data: {
                    admin_url: `http://${vps.host}:5555`,
                    api_key: null,
                    is_deployed: false,
                    instructions: [
                        '1. Deploy Evilginx first by clicking "Deploy" or "Update"',
                        '2. Once deployed, the API key will appear here',
                        '3. Use the API key to log into the admin dashboard'
                    ]
                }
            });
        }
        
        res.json({ 
            success: true, 
            data: {
                admin_url: `http://${vps.host}:5555`,
                api_key: vps.admin_api_key,
                is_deployed: true,
                instructions: [
                    `1. Open the Admin Dashboard: http://${vps.host}:5555`,
                    '2. Click "API Key" tab on the login page',
                    '3. Enter the API key shown below',
                    '4. Click "Sign In" to access the dashboard'
                ]
            }
        });
    } catch (error) {
        console.error('Get admin access error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get admin access info.',
            data: {
                admin_url: null,
                api_key: null
            }
        });
    }
});

// =====================================================
// DEPLOYMENT OPERATIONS
// =====================================================

// POST /api/vps/:id/deploy - Deploy/Update Evilginx
router.post('/:id/deploy', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        // Create deployment record
        const insertResult = await pool.query(`
            INSERT INTO deployments (vps_id, user_id, type, from_version, triggered_by)
            VALUES ($1, $2, $3, $4, 'manual')
            RETURNING *
        `, [
            req.params.id,
            req.user.id,
            req.vps.is_deployed ? 'update' : 'initial',
            req.vps.deployed_version
        ]);

        const deployment = insertResult.rows[0];

        // Start deployment (async - don't wait)
        sshService.deploy(req.params.id, deployment.id).catch(err => {
            console.error('Deployment error:', err);
        });

        res.json({
            success: true,
            message: 'Deployment started',
            data: {
                deployment_id: deployment.id,
                vps_id: req.params.id,
                status: 'in_progress'
            }
        });
    } catch (error) {
        console.error('Deploy error:', error);
        res.status(500).json({ success: false, message: 'Failed to start deployment' });
    }
});

// ✅ NEW: GET /api/vps/:id/deployments/:deploymentId/stream - Stream deployment logs (SSE)
router.get('/:id/deployments/:deploymentId/stream', authenticate, checkVPSOwnership, async (req, res) => {
    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    
    const { deploymentId } = req.params;
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to deployment stream' })}\n\n`);
    
    // Poll for deployment logs and send them
    const pollInterval = setInterval(async () => {
        try {
            // Get latest logs
            const logsResult = await pool.query(
                `SELECT level, message, timestamp FROM deployment_logs 
                 WHERE deployment_id = $1 
                 ORDER BY timestamp DESC LIMIT 50`,
                [deploymentId]
            );
            
            // Get deployment status
            const deployResult = await pool.query(
                'SELECT status, error_message FROM deployments WHERE id = $1',
                [deploymentId]
            );
            
            if (deployResult.rows.length > 0) {
                const deployment = deployResult.rows[0];
                
                // Send status update
                res.write(`data: ${JSON.stringify({ 
                    type: 'status', 
                    status: deployment.status,
                    error: deployment.error_message 
                })}\n\n`);
                
                // If deployment finished, close connection
                if (deployment.status === 'completed' || deployment.status === 'failed') {
                    clearInterval(pollInterval);
                    res.write(`data: ${JSON.stringify({ type: 'done', status: deployment.status })}\n\n`);
                    res.end();
                }
            }
        } catch (error) {
            console.error('SSE polling error:', error);
            clearInterval(pollInterval);
            res.end();
        }
    }, 1000); // Poll every second
    
    // Cleanup on client disconnect
    req.on('close', () => {
        clearInterval(pollInterval);
        res.end();
    });
});

// GET /api/vps/:id/deployments - List deployments
router.get('/:id/deployments', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM deployments 
            WHERE vps_id = $1 
            ORDER BY created_at DESC 
            LIMIT 20
        `, [req.params.id]);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('List deployments error:', error);
        res.status(500).json({ success: false, message: 'Failed to list deployments' });
    }
});

// GET /api/vps/:id/deployments/:deploymentId - Get deployment details
router.get('/:id/deployments/:deploymentId', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const deployment = await pool.query(
            'SELECT * FROM deployments WHERE id = $1 AND vps_id = $2', 
            [req.params.deploymentId, req.params.id]
        );
        
        const logs = await pool.query(
            'SELECT * FROM deployment_logs WHERE deployment_id = $1 ORDER BY timestamp', 
            [req.params.deploymentId]
        );

        if (deployment.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Deployment not found' });
        }

        res.json({
            success: true,
            data: {
                ...deployment.rows[0],
                logs: logs.rows
            }
        });
    } catch (error) {
        console.error('Get deployment error:', error);
        res.status(500).json({ success: false, message: 'Failed to get deployment details' });
    }
});

// =====================================================
// SERVICE CONTROL
// =====================================================

// POST /api/vps/:id/start - Start Evilginx service
router.post('/:id/start', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        if (!req.vps.is_deployed) {
            return res.status(400).json({ success: false, message: 'VPS not deployed yet. Please deploy first.' });
        }

        const result = await sshService.startService(req.params.id);
        res.json({ success: result.success, data: result });
    } catch (error) {
        console.error('Start service error:', error);
        res.status(500).json({ success: false, message: 'Failed to start service' });
    }
});

// POST /api/vps/:id/stop - Stop Evilginx service
router.post('/:id/stop', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const result = await sshService.stopService(req.params.id);
        res.json({ success: result.success, data: result });
    } catch (error) {
        console.error('Stop service error:', error);
        res.status(500).json({ success: false, message: 'Failed to stop service' });
    }
});

// POST /api/vps/:id/restart - Restart Evilginx service
router.post('/:id/restart', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        if (!req.vps.is_deployed) {
            return res.status(400).json({ success: false, message: 'VPS not deployed yet. Please deploy first.' });
        }

        const result = await sshService.restartService(req.params.id);
        res.json({ success: result.success, data: result });
    } catch (error) {
        console.error('Restart service error:', error);
        res.status(500).json({ success: false, message: 'Failed to restart service' });
    }
});

// GET /api/vps/:id/logs - Get service logs
router.get('/:id/logs', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const lines = parseInt(req.query.lines) || 100;
        const logs = await sshService.getLogs(req.params.id, lines);
        res.json({ success: true, data: { logs } });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ success: false, message: 'Failed to get logs' });
    }
});

// =====================================================
// EXEC COMMAND (Admin only)
// =====================================================

// ✅ SECURITY FIX: Whitelist-only command execution
// Define ONLY safe, predefined operations
const ALLOWED_COMMANDS = {
    'status': 'systemctl status evilginx',
    'restart': 'systemctl restart evilginx',
    'stop': 'systemctl stop evilginx',
    'start': 'systemctl start evilginx',
    'check-disk': 'df -h',
    'check-memory': 'free -h',
    'check-cpu': 'top -bn1 | head -20',
    'check-processes': 'ps aux | head -20',
    'evilginx-version': 'evilginx version || echo "Not installed"',
    'view-config': 'cat /opt/evilginx/config.yml 2>/dev/null || echo "Config not found"',
    'list-phishlets': 'ls -la /opt/evilginx/phishlets/ 2>/dev/null || echo "Phishlets directory not found"',
    'check-logs': 'tail -n 50 /var/log/evilginx.log 2>/dev/null || journalctl -u evilginx -n 50',
    'network-status': 'ss -tuln | grep LISTEN',
    'uptime': 'uptime'
};

// POST /api/vps/:id/exec - Execute predefined commands only
router.post('/:id/exec', authenticate, checkVPSOwnership, async (req, res) => {
    try {
        const { action } = req.body;  // Changed from 'command' to 'action'
        
        if (!action) {
            return res.status(400).json({ 
                success: false, 
                message: 'Action is required',
                allowed_actions: Object.keys(ALLOWED_COMMANDS)
            });
        }

        // ✅ WHITELIST ONLY - No arbitrary commands allowed
        const command = ALLOWED_COMMANDS[action];
        if (!command) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid action. Only predefined actions are allowed.',
                allowed_actions: Object.keys(ALLOWED_COMMANDS)
            });
        }

        // ✅ Audit logging for security monitoring
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
            [
                req.user.id, 
                'vps.exec', 
                'vps', 
                req.params.id, 
                JSON.stringify({ action, command, vpsName: req.vps.name }), 
                req.ip || req.connection.remoteAddress
            ]
        );

        // Execute the predefined command
        const result = await sshService.exec(req.params.id, command, 10000);  // Reduced timeout
        
        res.json({ 
            success: true, 
            data: {
                action: action,
                output: result
            }
        });
    } catch (error) {
        console.error('Exec error:', error);
        
        // ✅ Log failed attempts
        await pool.query(
            'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, 'vps.exec.failed', 'vps', req.params.id, JSON.stringify({ error: error.message }), req.ip]
        ).catch(() => {}); // Don't fail if audit log fails
        
        res.status(500).json({ success: false, message: 'Command execution failed' });
    }
});

module.exports = router;
