// =====================================================
// Evilginx Management Platform - Frontend Application
// =====================================================

class ManagementApp {
    constructor() {
        this.apiBase = 'http://localhost:3000/api';
        this.token = localStorage.getItem('token');
        this.user = JSON.parse(localStorage.getItem('user') || 'null');
        this.vpsList = [];
        this.currentPage = 'overview';
        
        this.init();
    }

    // =====================================================
    // INITIALIZATION
    // =====================================================

    init() {
        this.bindEvents();
        
        if (this.token && this.user) {
            this.showDashboard();
            this.loadDashboardData();
        } else {
            this.showLoginScreen();
        }
    }

    bindEvents() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login();
        });

        // Register form
        document.getElementById('register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register();
        });

        // Switch between login/register
        document.getElementById('show-register').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('register-screen').classList.remove('hidden');
        });

        document.getElementById('show-login').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('register-screen').classList.add('hidden');
            document.getElementById('login-screen').classList.remove('hidden');
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                this.navigateTo(page);
            });
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Auth type toggle in VPS modal
        document.querySelectorAll('input[name="auth-type"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'key') {
                    document.getElementById('password-field').classList.add('hidden');
                    document.getElementById('sshkey-field').classList.remove('hidden');
                } else {
                    document.getElementById('password-field').classList.remove('hidden');
                    document.getElementById('sshkey-field').classList.add('hidden');
                }
            });
        });

        // GitHub settings form
        document.getElementById('github-settings-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveGitHubSettings();
        });
    }

    // =====================================================
    // SCREENS
    // =====================================================

    showLoginScreen() {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('register-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.add('hidden');
    }

    showDashboard() {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('register-screen').classList.add('hidden');
        document.getElementById('dashboard-screen').classList.remove('hidden');
        
        // Update user info
        if (this.user) {
            document.getElementById('user-name').textContent = this.user.username || 'User';
            document.getElementById('user-avatar').textContent = (this.user.username || 'U').charAt(0).toUpperCase();
            document.getElementById('account-email').textContent = this.user.email;
        }
    }

    navigateTo(page) {
        this.currentPage = page;
        
        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.page === page);
        });

        // Show page
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        // Load page data
        this.loadPageData(page);
    }

    loadPageData(page) {
        switch (page) {
            case 'overview':
                this.loadDashboardData();
                break;
            case 'vps':
                this.loadVPSList();
                break;
            case 'deployments':
                this.loadDeployments();
                break;
            case 'settings':
                this.loadGitHubSettings();
                break;
        }
    }

    // =====================================================
    // API
    // =====================================================

    async apiRequest(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.apiBase}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`,
                    ...options.headers
                }
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    this.logout();
                }
                throw new Error(data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    // =====================================================
    // AUTHENTICATION
    // =====================================================

    async login() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            this.token = data.token;
            this.user = data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));

            this.showDashboard();
            this.loadDashboardData();
            this.showToast('Welcome back!', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async register() {
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-confirm').value;

        if (password !== confirm) {
            this.showToast('Passwords do not match', 'error');
            return;
        }

        try {
            const response = await fetch(`${this.apiBase}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Registration failed');
            }

            this.token = data.token;
            this.user = data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));

            this.showDashboard();
            this.loadDashboardData();
            this.showToast('Account created successfully!', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.showLoginScreen();
    }

    // =====================================================
    // DASHBOARD DATA
    // =====================================================

    async loadDashboardData() {
        try {
            const data = await this.apiRequest('/vps');
            this.vpsList = data.data || [];
            
            // Update stats
            document.getElementById('stat-vps-count').textContent = this.vpsList.length;
            document.getElementById('stat-running-count').textContent = 
                this.vpsList.filter(v => v.status === 'running').length;
            document.getElementById('stat-error-count').textContent = 
                this.vpsList.filter(v => v.status === 'error' || v.status === 'offline').length;
            
            // Get deployment count
            let totalDeployments = 0;
            for (const vps of this.vpsList) {
                totalDeployments += parseInt(vps.deployment_count) || 0;
            }
            document.getElementById('stat-deploy-count').textContent = totalDeployments;
            
            // Update VPS slots in settings
            document.getElementById('account-vps-used').textContent = this.vpsList.length;
            
            // Load recent activity
            this.loadRecentActivity();
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        }
    }

    async loadRecentActivity() {
        const activityList = document.getElementById('recent-activity');
        
        if (this.vpsList.length === 0) {
            activityList.innerHTML = '<li class="activity-item placeholder">No recent activity</li>';
            return;
        }

        const activities = [];
        
        for (const vps of this.vpsList) {
            if (vps.deployed_at) {
                activities.push({
                    type: 'deploy',
                    message: `Deployed to ${vps.name}`,
                    time: new Date(vps.deployed_at),
                    status: vps.status
                });
            }
            if (vps.last_heartbeat) {
                activities.push({
                    type: 'heartbeat',
                    message: `${vps.name} heartbeat`,
                    time: new Date(vps.last_heartbeat),
                    status: 'running'
                });
            }
        }

        activities.sort((a, b) => b.time - a.time);
        const recent = activities.slice(0, 5);

        if (recent.length === 0) {
            activityList.innerHTML = '<li class="activity-item placeholder">No recent activity</li>';
            return;
        }

        activityList.innerHTML = recent.map(a => `
            <li class="activity-item">
                <span class="activity-dot ${a.status === 'error' ? 'error' : a.status === 'running' ? '' : 'warning'}"></span>
                <span>${a.message}</span>
                <span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${this.formatTimeAgo(a.time)}</span>
            </li>
        `).join('');
    }

    // =====================================================
    // VPS MANAGEMENT
    // =====================================================

    async loadVPSList() {
        try {
            const data = await this.apiRequest('/vps');
            this.vpsList = data.data || [];
            this.renderVPSList();
        } catch (error) {
            this.showToast('Failed to load VPS list', 'error');
        }
    }

    renderVPSList() {
        const container = document.getElementById('vps-list');
        
        if (this.vpsList.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="14" rx="2"/>
                        <path d="M8 21h8M12 17v4"/>
                    </svg>
                    <h3>No VPS Servers</h3>
                    <p>Add your first VPS server to get started</p>
                    <button class="btn btn-primary" onclick="app.showAddVPSModal()">
                        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                        Add VPS
                    </button>
                </div>
            `;
            return;
        }

        container.innerHTML = this.vpsList.map(vps => this.renderVPSCard(vps)).join('');
    }

    renderVPSCard(vps) {
        const uptime = vps.uptime_seconds ? this.formatUptime(vps.uptime_seconds) : '-';
        const lastHeartbeat = vps.last_heartbeat ? this.formatTimeAgo(new Date(vps.last_heartbeat)) : 'Never';
        
        return `
            <div class="vps-card" data-id="${vps.id}">
                <div class="vps-card-header">
                    <div>
                        <div class="vps-name">${this.escapeHtml(vps.name)}</div>
                        <div class="vps-host">${this.escapeHtml(vps.host)}:${vps.port}</div>
                    </div>
                    <span class="vps-status ${vps.status}">${vps.status}</span>
                </div>
                <div class="vps-info">
                    <div class="vps-info-item">
                        <span class="vps-info-label">Version</span>
                        <span class="vps-info-value">${vps.deployed_version || 'Not deployed'}</span>
                    </div>
                    <div class="vps-info-item">
                        <span class="vps-info-label">Uptime</span>
                        <span class="vps-info-value">${uptime}</span>
                    </div>
                    <div class="vps-info-item">
                        <span class="vps-info-label">Last Check</span>
                        <span class="vps-info-value">${lastHeartbeat}</span>
                    </div>
                    <div class="vps-info-item">
                        <span class="vps-info-label">Deployments</span>
                        <span class="vps-info-value">${vps.deployment_count || 0}</span>
                    </div>
                </div>
                <div class="vps-actions">
                    ${vps.is_deployed ? `
                        ${vps.status === 'running' ? `
                            <button class="btn btn-secondary btn-sm" onclick="app.stopVPS('${vps.id}')">Stop</button>
                        ` : `
                            <button class="btn btn-primary btn-sm" onclick="app.startVPS('${vps.id}')">Start</button>
                        `}
                        <button class="btn btn-secondary btn-sm" onclick="app.restartVPS('${vps.id}')">Restart</button>
                        <button class="btn btn-secondary btn-sm" onclick="app.updateVPS('${vps.id}')">Update</button>
                    ` : `
                        <button class="btn btn-primary btn-sm" onclick="app.deployVPS('${vps.id}')">Deploy</button>
                    `}
                    <button class="btn btn-secondary btn-sm" onclick="app.showVPSDetails('${vps.id}')">Details</button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteVPS('${vps.id}')">Delete</button>
                </div>
            </div>
        `;
    }

    showAddVPSModal() {
        if (this.vpsList.length >= 2) {
            this.showToast('Maximum 2 VPS instances allowed', 'warning');
            return;
        }
        
        // Reset form
        document.getElementById('add-vps-form').reset();
        document.getElementById('vps-port').value = '22';
        document.getElementById('vps-github-branch').value = 'main';
        document.getElementById('vps-install-path').value = '/opt/evilginx';
        document.getElementById('password-field').classList.remove('hidden');
        document.getElementById('sshkey-field').classList.add('hidden');
        
        document.getElementById('modal-title').textContent = 'Add VPS Server';
        document.getElementById('modal-backdrop').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-backdrop').classList.add('hidden');
    }

    async addVPS() {
        const data = {
            name: document.getElementById('vps-name').value,
            host: document.getElementById('vps-host').value,
            port: parseInt(document.getElementById('vps-port').value) || 22,
            username: document.getElementById('vps-username').value,
            auth_type: document.querySelector('input[name="auth-type"]:checked').value,
            github_repo: document.getElementById('vps-github-repo').value,
            github_branch: document.getElementById('vps-github-branch').value,
            install_path: document.getElementById('vps-install-path').value
        };

        if (data.auth_type === 'key') {
            data.ssh_key = document.getElementById('vps-sshkey').value;
        } else {
            data.password = document.getElementById('vps-password').value;
        }

        try {
            await this.apiRequest('/vps', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            this.closeModal();
            this.showToast('VPS added successfully!', 'success');
            this.loadVPSList();
            this.loadDashboardData();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deleteVPS(id) {
        if (!confirm('Are you sure you want to delete this VPS?')) return;

        try {
            await this.apiRequest(`/vps/${id}`, { method: 'DELETE' });
            this.showToast('VPS deleted', 'success');
            this.loadVPSList();
            this.loadDashboardData();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deployVPS(id) {
        try {
            await this.apiRequest(`/vps/${id}/deploy`, { method: 'POST' });
            this.showToast('Deployment started! This may take a few minutes.', 'info');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async updateVPS(id) {
        try {
            await this.apiRequest(`/vps/${id}/deploy`, { method: 'POST' });
            this.showToast('Update started!', 'info');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async startVPS(id) {
        try {
            await this.apiRequest(`/vps/${id}/start`, { method: 'POST' });
            this.showToast('Starting service...', 'info');
            setTimeout(() => this.loadVPSList(), 2000);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async stopVPS(id) {
        try {
            await this.apiRequest(`/vps/${id}/stop`, { method: 'POST' });
            this.showToast('Service stopped', 'success');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async restartVPS(id) {
        try {
            await this.apiRequest(`/vps/${id}/restart`, { method: 'POST' });
            this.showToast('Restarting service...', 'info');
            setTimeout(() => this.loadVPSList(), 2000);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async showVPSDetails(id) {
        const vps = this.vpsList.find(v => v.id === id);
        if (!vps) return;

        const content = document.getElementById('vps-details-content');
        document.getElementById('vps-details-title').textContent = vps.name;

        // Get system info
        let systemInfo = vps.system_info || {};
        try {
            const data = await this.apiRequest(`/vps/${id}/system-info`);
            if (data.success) {
                systemInfo = data.data;
            }
        } catch (e) {
            console.error('Failed to get system info:', e);
        }

        content.innerHTML = `
            <div class="details-section">
                <h4>Connection</h4>
                <div class="details-row">
                    <span>Host</span>
                    <span>${this.escapeHtml(vps.host)}</span>
                </div>
                <div class="details-row">
                    <span>Port</span>
                    <span>${vps.port}</span>
                </div>
                <div class="details-row">
                    <span>Username</span>
                    <span>${this.escapeHtml(vps.username)}</span>
                </div>
                <div class="details-row">
                    <span>Auth Type</span>
                    <span>${vps.auth_type}</span>
                </div>
            </div>
            <div class="details-section">
                <h4>Deployment</h4>
                <div class="details-row">
                    <span>Status</span>
                    <span class="badge ${vps.status === 'running' ? 'badge-success' : vps.status === 'error' ? 'badge-error' : 'badge-warning'}">${vps.status}</span>
                </div>
                <div class="details-row">
                    <span>Version</span>
                    <span>${vps.deployed_version || 'Not deployed'}</span>
                </div>
                <div class="details-row">
                    <span>Deployed At</span>
                    <span>${vps.deployed_at ? new Date(vps.deployed_at).toLocaleString() : '-'}</span>
                </div>
                <div class="details-row">
                    <span>Install Path</span>
                    <span>${vps.install_path || '/opt/evilginx'}</span>
                </div>
            </div>
            <div class="details-section">
                <h4>System</h4>
                <div class="details-row">
                    <span>OS</span>
                    <span>${systemInfo.os || 'Unknown'}</span>
                </div>
                <div class="details-row">
                    <span>CPU Cores</span>
                    <span>${systemInfo.cpu_cores || '-'}</span>
                </div>
                <div class="details-row">
                    <span>Memory</span>
                    <span>${systemInfo.memory_used || '-'}MB / ${systemInfo.memory_total || '-'}MB</span>
                </div>
                <div class="details-row">
                    <span>Disk</span>
                    <span>${systemInfo.disk_used || '-'} / ${systemInfo.disk_total || '-'} (${systemInfo.disk_percent || '-'})</span>
                </div>
            </div>
            <div class="details-section">
                <h4>GitHub</h4>
                <div class="details-row">
                    <span>Repository</span>
                    <span style="word-break: break-all;">${vps.github_repo || '-'}</span>
                </div>
                <div class="details-row">
                    <span>Branch</span>
                    <span>${vps.github_branch || 'main'}</span>
                </div>
            </div>
            <div class="details-section" style="grid-column: 1 / -1;">
                <h4>Actions</h4>
                <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px;">
                    <button class="btn btn-secondary btn-sm" onclick="app.viewLogs('${id}')">View Logs</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.refreshStatus('${id}')">Refresh Status</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.testConnection('${id}')">Test Connection</button>
                </div>
            </div>
        `;

        document.getElementById('vps-details-modal-backdrop').classList.remove('hidden');
    }

    closeDetailsModal() {
        document.getElementById('vps-details-modal-backdrop').classList.add('hidden');
    }

    async viewLogs(id) {
        try {
            const data = await this.apiRequest(`/vps/${id}/logs?lines=200`);
            document.getElementById('logs-output').textContent = data.data?.logs || 'No logs available';
            document.getElementById('logs-modal-backdrop').classList.remove('hidden');
        } catch (error) {
            this.showToast('Failed to load logs', 'error');
        }
    }

    closeLogsModal() {
        document.getElementById('logs-modal-backdrop').classList.add('hidden');
    }

    async refreshStatus(id) {
        try {
            await this.apiRequest(`/vps/${id}/status`);
            this.showToast('Status refreshed', 'success');
            this.showVPSDetails(id);
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async testConnection(id) {
        try {
            const data = await this.apiRequest(`/vps/${id}/test-connection`, { method: 'POST' });
            if (data.data?.success) {
                this.showToast('Connection successful!', 'success');
            } else {
                this.showToast(`Connection failed: ${data.data?.error}`, 'error');
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // =====================================================
    // DEPLOYMENTS
    // =====================================================

    async loadDeployments() {
        const tbody = document.getElementById('deployments-table');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Loading...</td></tr>';

        try {
            const deployments = [];
            
            for (const vps of this.vpsList) {
                const data = await this.apiRequest(`/vps/${vps.id}/deployments`);
                if (data.data) {
                    data.data.forEach(d => {
                        d.vps_name = vps.name;
                    });
                    deployments.push(...data.data);
                }
            }

            deployments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            if (deployments.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No deployments yet</td></tr>';
                return;
            }

            tbody.innerHTML = deployments.slice(0, 50).map(d => `
                <tr>
                    <td>${this.escapeHtml(d.vps_name)}</td>
                    <td><span class="badge badge-info">${d.type}</span></td>
                    <td><span class="badge ${d.status === 'success' ? 'badge-success' : d.status === 'failed' ? 'badge-error' : 'badge-warning'}">${d.status}</span></td>
                    <td><code>${d.to_version || d.git_commit || '-'}</code></td>
                    <td>${d.duration_seconds ? `${d.duration_seconds}s` : '-'}</td>
                    <td>${new Date(d.created_at).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" onclick="app.viewDeploymentLogs('${d.vps_id}', '${d.id}')">Logs</button>
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--error);">Failed to load deployments</td></tr>';
        }
    }

    async viewDeploymentLogs(vpsId, deploymentId) {
        try {
            const data = await this.apiRequest(`/vps/${vpsId}/deployments/${deploymentId}`);
            const logs = data.data?.logs || [];
            
            const logText = logs.map(l => 
                `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level.toUpperCase()}] ${l.message}`
            ).join('\n');

            document.getElementById('logs-output').textContent = logText || 'No logs available';
            document.getElementById('logs-modal-backdrop').classList.remove('hidden');
        } catch (error) {
            this.showToast('Failed to load deployment logs', 'error');
        }
    }

    // =====================================================
    // SETTINGS
    // =====================================================

    async loadGitHubSettings() {
        try {
            const data = await this.apiRequest('/github/settings');
            if (data.data) {
                document.getElementById('github-repo').value = data.data.repo_url || '';
                document.getElementById('github-branch').value = data.data.branch || 'main';
                document.getElementById('github-auto-update').checked = data.data.auto_update_enabled;
                document.getElementById('github-secret').value = data.data.secret_token || '';
            }
            
            // Set webhook URL
            document.getElementById('github-webhook-url').value = `${this.apiBase}/github/webhook`;
        } catch (error) {
            console.error('Failed to load GitHub settings:', error);
        }
    }

    async saveGitHubSettings() {
        try {
            await this.apiRequest('/github/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    repo_url: document.getElementById('github-repo').value,
                    branch: document.getElementById('github-branch').value,
                    auto_update_enabled: document.getElementById('github-auto-update').checked
                })
            });
            this.showToast('GitHub settings saved!', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async regenerateWebhookSecret() {
        if (!confirm('This will invalidate the current webhook secret. Continue?')) return;

        try {
            const data = await this.apiRequest('/github/regenerate-secret', { method: 'POST' });
            if (data.data?.secret_token) {
                document.getElementById('github-secret').value = data.data.secret_token;
                this.showToast('Webhook secret regenerated. Update your GitHub webhook settings!', 'warning');
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async triggerUpdateAll() {
        if (!confirm('This will update all deployed VPS instances. Continue?')) return;

        try {
            const data = await this.apiRequest('/github/test-update', { method: 'POST' });
            this.showToast(`Update triggered for ${data.data?.length || 0} VPS instance(s)`, 'info');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // =====================================================
    // UTILITIES
    // =====================================================

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    formatUptime(seconds) {
        if (!seconds) return '-';
        
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
}

// Initialize app
const app = new ManagementApp();

