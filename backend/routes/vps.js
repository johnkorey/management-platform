// =====================================================
// VPS Management Routes
// =====================================================

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authenticateToken, requireActiveSubscription } = require('../middleware/auth');
const SSHService = require('../services/ssh');

// Database pool
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

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
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                v.*,
                (SELECT COUNT(*) FROM deployments d WHERE d.vps_id = v.id) as deployment_count,
                (SELECT status FROM deployments d WHERE d.vps_id = v.id ORDER BY created_at DESC LIMIT 1) as last_deployment_status
            FROM vps_instances v
            WHERE v.user_id = $1
            ORDER BY v.created_at DESC
        `, [req.user.id]);

        // Don't return encrypted credentials
        const vpsList = result.rows.map(vps => ({
            ...vps,
            password_encrypted: undefined,
            ssh_key_encrypted: undefined,
            has_password: !!vps.password_encrypted,
            has_ssh_key: !!vps.ssh_key_encrypted
        }));

        res.json({ success: true, data: vpsList });
    } catch (error) {
        console.error('List VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to list VPS instances' });
    }
});

// GET /api/vps/:id - Get VPS details
router.get('/:id', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const vps = {
            ...req.vps,
            password_encrypted: undefined,
            ssh_key_encrypted: undefined,
            has_password: !!req.vps.password_encrypted,
            has_ssh_key: !!req.vps.ssh_key_encrypted
        };

        res.json({ success: true, data: vps });
    } catch (error) {
        console.error('Get VPS error:', error);
        res.status(500).json({ success: false, message: 'Failed to get VPS details' });
    }
});

// POST /api/vps - Add new VPS (max 2 per user)
router.post('/', authenticateToken, requireActiveSubscription, async (req, res) => {
    try {
        const { name, description, host, port, username, auth_type, password, ssh_key, github_repo, github_branch, install_path } = req.body;

        // Validate required fields
        if (!name || !host || !username) {
            return res.status(400).json({ 
                success: false, 
                message: 'Name, host, and username are required' 
            });
        }

        // Check max VPS limit (2 per user)
        const countResult = await pool.query(
            'SELECT COUNT(*) FROM vps_instances WHERE user_id = $1',
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
        const result = await pool.query(`
            INSERT INTO vps_instances (
                user_id, name, description, host, port, username, 
                auth_type, password_encrypted, ssh_key_encrypted,
                github_repo, github_branch, install_path, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
            RETURNING *
        `, [
            req.user.id, name, description || null, host, port || 22, username,
            auth_type || 'password', passwordEncrypted, sshKeyEncrypted,
            github_repo || 'https://github.com/yourusername/evilginx2.git',
            github_branch || 'main',
            install_path || '/opt/evilginx'
        ]);

        const vps = result.rows[0];

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

            // Get system info
            try {
                await pool.query('UPDATE vps_instances SET status = $1 WHERE id = $2', ['connecting', vps.id]);
                vps.status = 'connected';
            } catch (e) {
                console.error('Failed to get system info:', e);
            }
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
        if (error.message?.includes('Maximum 2 VPS')) {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({ success: false, message: 'Failed to add VPS' });
    }
});

// PUT /api/vps/:id - Update VPS details
router.put('/:id', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const { name, description, host, port, username, auth_type, password, ssh_key, github_repo, github_branch, install_path } = req.body;

        // Build update query dynamically
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (name) { updates.push(`name = $${paramCount++}`); values.push(name); }
        if (description !== undefined) { updates.push(`description = $${paramCount++}`); values.push(description); }
        if (host) { updates.push(`host = $${paramCount++}`); values.push(host); }
        if (port) { updates.push(`port = $${paramCount++}`); values.push(port); }
        if (username) { updates.push(`username = $${paramCount++}`); values.push(username); }
        if (auth_type) { updates.push(`auth_type = $${paramCount++}`); values.push(auth_type); }
        if (github_repo) { updates.push(`github_repo = $${paramCount++}`); values.push(github_repo); }
        if (github_branch) { updates.push(`github_branch = $${paramCount++}`); values.push(github_branch); }
        if (install_path) { updates.push(`install_path = $${paramCount++}`); values.push(install_path); }

        // Handle credential updates
        if (password) {
            updates.push(`password_encrypted = $${paramCount++}`);
            values.push(sshService.encryptCredential(password));
        }
        if (ssh_key) {
            updates.push(`ssh_key_encrypted = $${paramCount++}`);
            values.push(sshService.encryptCredential(ssh_key));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE vps_instances SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );

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
router.delete('/:id', authenticateToken, checkVPSOwnership, async (req, res) => {
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
router.post('/:id/test-connection', authenticateToken, checkVPSOwnership, async (req, res) => {
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
router.get('/:id/status', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const status = await sshService.getServiceStatus(req.params.id);
        res.json({ success: true, data: status });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ success: false, message: 'Failed to get status' });
    }
});

// GET /api/vps/:id/system-info - Get system information
router.get('/:id/system-info', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const info = await sshService.getSystemInfo(req.params.id);
        
        // Update in database
        await pool.query(
            'UPDATE vps_instances SET system_info = $1 WHERE id = $2',
            [info, req.params.id]
        );

        res.json({ success: true, data: info });
    } catch (error) {
        console.error('Get system info error:', error);
        res.status(500).json({ success: false, message: 'Failed to get system info' });
    }
});

// =====================================================
// DEPLOYMENT OPERATIONS
// =====================================================

// POST /api/vps/:id/deploy - Deploy/Update Evilginx
router.post('/:id/deploy', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        // Create deployment record
        const deployResult = await pool.query(`
            INSERT INTO deployments (vps_id, user_id, type, from_version, triggered_by)
            VALUES ($1, $2, $3, $4, 'manual')
            RETURNING *
        `, [
            req.params.id,
            req.user.id,
            req.vps.is_deployed ? 'update' : 'initial',
            req.vps.deployed_version
        ]);

        const deployment = deployResult.rows[0];

        // Start deployment (async - don't wait)
        sshService.deploy(req.params.id, deployment.id).catch(err => {
            console.error('Deployment error:', err);
        });

        res.json({
            success: true,
            message: 'Deployment started',
            data: {
                deployment_id: deployment.id,
                status: 'in_progress'
            }
        });
    } catch (error) {
        console.error('Deploy error:', error);
        res.status(500).json({ success: false, message: 'Failed to start deployment' });
    }
});

// GET /api/vps/:id/deployments - List deployments
router.get('/:id/deployments', authenticateToken, checkVPSOwnership, async (req, res) => {
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
router.get('/:id/deployments/:deploymentId', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const [deployment, logs] = await Promise.all([
            pool.query('SELECT * FROM deployments WHERE id = $1 AND vps_id = $2', [req.params.deploymentId, req.params.id]),
            pool.query('SELECT * FROM deployment_logs WHERE deployment_id = $1 ORDER BY timestamp', [req.params.deploymentId])
        ]);

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
router.post('/:id/start', authenticateToken, checkVPSOwnership, async (req, res) => {
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
router.post('/:id/stop', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const result = await sshService.stopService(req.params.id);
        res.json({ success: result.success, data: result });
    } catch (error) {
        console.error('Stop service error:', error);
        res.status(500).json({ success: false, message: 'Failed to stop service' });
    }
});

// POST /api/vps/:id/restart - Restart Evilginx service
router.post('/:id/restart', authenticateToken, checkVPSOwnership, async (req, res) => {
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
router.get('/:id/logs', authenticateToken, checkVPSOwnership, async (req, res) => {
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

// POST /api/vps/:id/exec - Execute command (advanced users)
router.post('/:id/exec', authenticateToken, checkVPSOwnership, async (req, res) => {
    try {
        const { command } = req.body;
        
        if (!command) {
            return res.status(400).json({ success: false, message: 'Command is required' });
        }

        // Security: Block dangerous commands
        const blockedPatterns = ['rm -rf /', 'mkfs', 'dd if=', '> /dev/sd', 'chmod -R 777 /', ':(){'];
        for (const pattern of blockedPatterns) {
            if (command.includes(pattern)) {
                return res.status(400).json({ success: false, message: 'Command blocked for security reasons' });
            }
        }

        const result = await sshService.exec(req.params.id, command, 30000);
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Exec error:', error);
        res.status(500).json({ success: false, message: 'Command execution failed' });
    }
});

module.exports = router;

