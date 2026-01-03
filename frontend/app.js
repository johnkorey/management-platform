// =====================================================
// Evilginx Management Platform - Frontend Application
// =====================================================

class ManagementApp {
    constructor() {
        // Use relative URL - nginx proxies /api to backend
        this.apiBase = '/api';
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
            // ✅ SECURITY FIX: Apply role-based UI restrictions
            this.applyRoleBasedUI();
            // ✅ Start periodic connection monitoring
            this.startConnectionMonitor();
        } else {
            this.showLoginScreen();
        }
    }
    
    // ✅ SECURITY FIX: Check if current user is admin
    isAdmin() {
        if (!this.user) return false;
        const metadata = this.user.metadata || {};
        return metadata.role === 'admin' || this.user.email === 'admin@evilginx.local';
    }
    
    // ✅ SECURITY FIX: Hide admin-only features from regular users
    applyRoleBasedUI() {
        if (this.isAdmin()) {
            // Show admin-only features
            document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
                el.style.display = '';
            });
        } else {
            // Hide GitHub Auto-Update settings (admin only)
            const githubSettings = document.querySelector('.card:has(#github-settings-form)');
            if (githubSettings) {
                githubSettings.style.display = 'none';
            }
            
            // Hide any other admin-only sections and menu items
            document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
                el.style.display = 'none';
            });
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

        // ✅ FIX: Switch between login/register (only if elements exist)
        const showRegisterBtn = document.getElementById('show-register');
        if (showRegisterBtn) {
            showRegisterBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('register-screen').classList.remove('hidden');
            });
        }

        const showLoginBtn = document.getElementById('show-login');
        if (showLoginBtn) {
            showLoginBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.getElementById('register-screen').classList.add('hidden');
                document.getElementById('login-screen').classList.remove('hidden');
            });
        }

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

        // ✅ SECURITY FIX: GitHub settings form (admin only)
        // ✅ FIX: GitHub settings form (only if element exists)
        const githubForm = document.getElementById('github-settings-form');
        if (githubForm) {
            githubForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!this.isAdmin()) {
                    alert('Access denied: Admin privileges required');
                    return;
                }
                if (typeof this.saveGitHubSettings === 'function') {
                    this.saveGitHubSettings();
                }
            });
        }
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
            const emailEl = document.getElementById('account-email');
            if (emailEl) {
                emailEl.textContent = this.user.email;
            }
            
            // ✅ SECURITY FIX: Show admin badge if user is admin
            if (this.isAdmin()) {
                const adminBadge = document.getElementById('admin-badge');
                if (adminBadge) {
                    adminBadge.style.display = 'inline-block';
                }
            }
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
                if (typeof this.loadDeployments === 'function') {
                    this.loadDeployments();
                }
                break;
                        case 'builds':
                if (typeof this.initBuildsPage === 'function') {
                    this.initBuildsPage();
                }
                break;
            case 'users':
                // ✅ SECURITY FIX: User management (admin only)
                if (this.isAdmin()) {
                    this.loadUsersList();
                }
                break;
            case 'settings':
                // ✅ SECURITY FIX: Only load GitHub settings if admin
                if (this.isAdmin() && typeof this.loadGitHubSettings === 'function') {
                    this.loadGitHubSettings();
                }
                break;
        }
    }
    
    // =====================================================
    // VPS MANAGEMENT
    // =====================================================
    
    async loadVPSList() {
        try {
            const data = await this.apiRequest('/vps');
            this.vpsList = data.data || [];
            
            const vpsGrid = document.getElementById('vps-list');
            if (!vpsGrid) return;
            
            vpsGrid.innerHTML = '';
            
            if (this.vpsList.length === 0) {
                vpsGrid.innerHTML = '<div class="empty-state">No VPS servers yet. Click "Add VPS" to get started.</div>';
                return;
            }
            
            this.vpsList.forEach(vps => {
                const card = document.createElement('div');
                card.className = 'vps-card';
                card.innerHTML = `
                    <div class="vps-header">
                        <h3>${this.escapeHtml(vps.name)}</h3>
                        <span class="badge badge-${vps.status === 'running' ? 'success' : 'warning'}">${vps.status}</span>
                    </div>
                    <div class="vps-info">
                        <p><strong>Host:</strong> ${this.escapeHtml(vps.host)}:${vps.port}</p>
                        <p><strong>Deployed:</strong> ${vps.is_deployed ? 'Yes' : 'No'}</p>
                        ${vps.is_deployed ? `<p><strong>Version:</strong> ${vps.deployed_version || 'Unknown'}</p>` : ''}
                    </div>
                    <div class="vps-actions">
                        ${!vps.is_deployed ? 
                            `<button class="btn btn-primary" onclick="app.deployVPS('${vps.id}')">Deploy</button>` :
                            `<button class="btn btn-success" onclick="app.manageVPS('${vps.id}')">Manage</button>`
                        }
                        <button class="btn btn-secondary" onclick="app.editVPS('${vps.id}')">Edit</button>
                        <button class="btn btn-error" onclick="app.deleteVPS('${vps.id}', '${this.escapeHtml(vps.name)}')">Delete</button>
                    </div>
                `;
                vpsGrid.appendChild(card);
            });
            
        } catch (error) {
            console.error('Failed to load VPS list:', error);
            this.showToast(error.message, 'error');
        }
    }
    
    showAddVPSModal() {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) {
            backdrop.classList.remove('hidden');
        }
    }
    
    closeModal() {
        const backdrop = document.getElementById('modal-backdrop');
        if (backdrop) {
            backdrop.classList.add('hidden');
        }
        // Reset form
        const form = document.getElementById('add-vps-form');
        if (form) {
            form.reset();
        }
    }
    
    async addVPS() {
        const name = document.getElementById('vps-name')?.value;
        const host = document.getElementById('vps-host')?.value;
        const port = document.getElementById('vps-port')?.value || 22;
        const username = document.getElementById('vps-username')?.value;
        const authType = document.querySelector('input[name="auth-type"]:checked')?.value || 'password';
        const password = document.getElementById('vps-password')?.value;
        const sshKey = document.getElementById('vps-sshkey')?.value;
        const githubRepo = document.getElementById('vps-github-repo')?.value;
        const githubBranch = document.getElementById('vps-github-branch')?.value || 'main';
        const installPath = document.getElementById('vps-install-path')?.value || '/opt/evilginx';
        
        if (!name || !host || !username) {
            this.showToast('Name, host, and username are required', 'error');
            return;
        }
        
        if (authType === 'password' && !password) {
            this.showToast('Password is required', 'error');
            return;
        }
        
        if (authType === 'key' && !sshKey) {
            this.showToast('SSH key is required', 'error');
            return;
        }
        
        try {
            await this.apiRequest('/vps', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    host,
                    port: parseInt(port),
                    username,
                    auth_type: authType,
                    password: authType === 'password' ? password : undefined,
                    ssh_key: authType === 'key' ? sshKey : undefined,
                    github_repo: githubRepo,
                    github_branch: githubBranch,
                    install_path: installPath
                })
            });
            
            this.showToast('VPS added successfully!', 'success');
            this.closeModal();
            this.loadVPSList();
            
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }
    
    async deployVPS(vpsId) {
        if (!confirm('Deploy Evilginx2 to this VPS? This may take 5-10 minutes.')) return;
        
        try {
            await this.apiRequest(`/vps/${vpsId}/deploy`, { method: 'POST' });
            this.showToast('Deployment started! Check deployment logs for progress.', 'info');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }
    
    async editVPS(vpsId) {
        this.showToast('Edit VPS feature coming soon', 'info');
    }
    
    async deleteVPS(vpsId, name) {
        if (!confirm(`Delete VPS "${name}"? This action cannot be undone.`)) return;
        
        try {
            await this.apiRequest(`/vps/${vpsId}`, { method: 'DELETE' });
            this.showToast('VPS deleted successfully', 'success');
            this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }
    
    async manageVPS(vpsId) {
        this.showToast('VPS management panel coming soon', 'info');
        // Future: Navigate to embedded Evilginx2 admin
    }
    
    async loadDeployments() {
        // Placeholder
        const table = document.getElementById('deployments-table');
        if (table) {
            table.innerHTML = '<tr><td colspan="7" style="text-align:center;">Deployment history coming soon</td></tr>';
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

            this.token = data.data.token;
            this.user = data.data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));

            this.showDashboard();
            this.loadDashboardData();
            // ✅ SECURITY FIX: Apply RBAC after login
            this.applyRoleBasedUI();
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

            this.token = data.data.token;
            this.user = data.data.user;
            localStorage.setItem('token', this.token);
            localStorage.setItem('user', JSON.stringify(this.user));

            this.showDashboard();
            this.loadDashboardData();
            // ✅ SECURITY FIX: Apply RBAC after registration
            this.applyRoleBasedUI();
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
            
            // ✅ Immediately refresh status for all VPS after loading list
            this.checkAllVPSStatus();
        } catch (error) {
            this.showToast('Failed to load VPS list', 'error');
        }
    }
    
    // Check status for all VPS and update UI
    async checkAllVPSStatus() {
        for (const vps of this.vpsList) {
            try {
                const statusResult = await this.apiRequest(`/vps/${vps.id}/status`);
                if (statusResult.success && statusResult.data) {
                    // Update local VPS data with new status
                    vps.connected = statusResult.data.connected;
                    if (statusResult.data.status) {
                        vps.status = statusResult.data.status;
                    }
                    // Re-render just this VPS card
                    const card = document.querySelector(`.vps-card[data-id="${vps.id}"]`);
                    if (card) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = this.renderVPSCard(vps);
                        card.replaceWith(tempDiv.firstElementChild);
                    }
                }
            } catch (e) {
                // Connection failed - mark as offline
                vps.status = 'offline';
                const card = document.querySelector(`.vps-card[data-id="${vps.id}"]`);
                if (card) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = this.renderVPSCard(vps);
                    card.replaceWith(tempDiv.firstElementChild);
                }
            }
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
        
        // Determine connection status for indicator
        const isConnected = ['running', 'connected', 'stopped'].includes(vps.status);
        const connectionClass = isConnected ? 'connected' : 'disconnected';
        const connectionTitle = isConnected ? 'Connected' : 'Disconnected';
        
        return `
            <div class="vps-card" data-id="${vps.id}">
                <div class="vps-card-header">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="connection-indicator ${connectionClass}" title="${connectionTitle}">
                            <span class="pulse-dot"></span>
                        </div>
                        <div>
                            <div class="vps-name">${this.escapeHtml(vps.name)}</div>
                            <div class="vps-host">${this.escapeHtml(vps.host)}:${vps.port}</div>
                        </div>
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
                        <button class="btn btn-primary btn-sm" onclick="app.updateVPS('${vps.id}')" title="Redeploy from source">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <path d="M23 4v6h-6M1 20v-6h6"/>
                                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                            </svg>
                            Update
                        </button>
                        <button class="btn btn-warning btn-sm" onclick="app.forceSSL('${vps.id}')" title="Force SSL certificate regeneration">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0110 0v4"/>
                            </svg>
                            Force SSL
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-sm" onclick="app.deployVPS('${vps.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                            </svg>
                            Deploy
                        </button>
                    `}
                    <button class="btn btn-secondary btn-sm" onclick="app.showVPSDetails('${vps.id}')">Details</button>
                    <button class="btn btn-danger btn-sm" onclick="app.deleteVPS('${vps.id}')">Delete</button>
                </div>
            </div>
        `;
    }

    async showAddVPSModal() {
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
        
        // GitHub settings are admin-only - backend will use admin-configured repo automatically
        
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
            // Get VPS info
            const vps = this.vpsList.find(v => v.id === id);
            if (!vps) {
                this.showToast('VPS not found', 'error');
                return;
            }
            
            // Start deployment
            const response = await this.apiRequest(`/vps/${id}/deploy`, { method: 'POST' });
            const deploymentId = response.data.deployment_id;
            
            // Show deployment progress modal
            this.showDeploymentProgress(id, deploymentId, vps.name);
            
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }
    
    // ✅ NEW: Show deployment progress with real-time logs
    showDeploymentProgress(vpsId, deploymentId, vpsName) {
        this.currentDeployment = { vpsId, deploymentId, vpsName };
        
        // Show modal
        document.getElementById('deployment-progress-modal-backdrop').classList.remove('hidden');
        document.getElementById('deployment-vps-name').textContent = vpsName;
        document.getElementById('deployment-status-badge').textContent = 'In Progress';
        document.getElementById('deployment-status-badge').className = 'badge badge-warning';
        document.getElementById('deployment-close-btn').disabled = true;
        
        // Reset terminal
        const terminal = document.getElementById('deployment-terminal');
        terminal.innerHTML = '<div class="terminal-line"><span class="terminal-prompt">$</span><span class="terminal-text">Starting deployment...</span></div>';
        
        // Reset progress
        document.getElementById('deployment-progress-fill').style.width = '0%';
        document.getElementById('deployment-progress-text').textContent = 'Initializing...';
        document.getElementById('deployment-progress-percent').textContent = '0%';
        
        // Start streaming logs
        this.streamDeploymentLogs(vpsId, deploymentId);
    }
    
    // ✅ NEW: Stream deployment logs via SSE
    streamDeploymentLogs(vpsId, deploymentId) {
        let lastLogCount = 0;
        let progress = 0;
        const progressSteps = {
            'Connecting': 5,
            'Checking': 10,
            'Installing Go': 20,
            'Installing git': 25,
            'Setting up': 30,
            'Cloning': 40,
            'Building': 60,
            'Creating license': 70,
            'Configuring service': 80,
            'Starting': 90,
            'completed': 100,
            'failed': 100
        };
        
        // Poll for logs (simplified approach instead of true SSE for compatibility)
        const pollInterval = setInterval(async () => {
            try {
                // Get latest logs
                const logsResponse = await fetch(`${this.apiBase}/vps/${vpsId}/deployments/${deploymentId}`, {
                    headers: { 'Authorization': `Bearer ${this.token}` }
                });
                
                if (!logsResponse.ok) {
                    clearInterval(pollInterval);
                    this.appendTerminalLine('Connection lost', 'error');
                    return;
                }
                
                const data = await logsResponse.json();
                const deployment = data.data;
                const logs = deployment.logs || [];
                
                // Append new logs
                if (logs.length > lastLogCount) {
                    const newLogs = logs.slice(lastLogCount);
                    newLogs.forEach(log => {
                        this.appendTerminalLine(log.message, log.level);
                        
                        // Update progress based on log content
                        for (const [keyword, percent] of Object.entries(progressSteps)) {
                            if (log.message.includes(keyword) || deployment.status === keyword) {
                                if (percent > progress) {
                                    progress = percent;
                                    this.updateProgress(progress, log.message);
                                }
                            }
                        }
                    });
                    lastLogCount = logs.length;
                }
                
                // Check if deployment finished
                if (deployment.status === 'completed') {
                    clearInterval(pollInterval);
                    this.updateProgress(100, 'Deployment completed successfully!');
                    document.getElementById('deployment-status-badge').textContent = 'Completed';
                    document.getElementById('deployment-status-badge').className = 'badge badge-success';
                    document.getElementById('deployment-progress-fill').classList.add('complete');
                    document.getElementById('deployment-close-btn').disabled = false;
                    document.getElementById('deployment-cancel-btn').style.display = 'none';
                    this.appendTerminalLine('✅ Deployment completed successfully!', 'success');
                    this.loadVPSList();
                    this.loadDashboardData();
                } else if (deployment.status === 'failed') {
                    clearInterval(pollInterval);
                    this.updateProgress(100, 'Deployment failed');
                    document.getElementById('deployment-status-badge').textContent = 'Failed';
                    document.getElementById('deployment-status-badge').className = 'badge badge-error';
                    document.getElementById('deployment-progress-fill').classList.add('error');
                    document.getElementById('deployment-close-btn').disabled = false;
                    document.getElementById('deployment-cancel-btn').style.display = 'none';
                    this.appendTerminalLine(`❌ Deployment failed: ${deployment.error_message || 'Unknown error'}`, 'error');
                    this.loadVPSList();
                }
                
            } catch (error) {
                console.error('Failed to poll deployment logs:', error);
                clearInterval(pollInterval);
                this.appendTerminalLine('Error fetching deployment logs', 'error');
            }
        }, 2000); // Poll every 2 seconds
        
        // Store interval for cleanup
        this.deploymentPollInterval = pollInterval;
    }
    
    // ✅ NEW: Append line to terminal
    appendTerminalLine(message, level = 'info') {
        const terminal = document.getElementById('deployment-terminal');
        const line = document.createElement('div');
        line.className = 'terminal-line';
        
        const prompt = document.createElement('span');
        prompt.className = 'terminal-prompt';
        prompt.textContent = level === 'error' ? '✗' : level === 'warning' ? '⚠' : level === 'success' ? '✓' : '$';
        
        const text = document.createElement('span');
        text.className = `terminal-text ${level}`;
        text.textContent = message;
        
        line.appendChild(prompt);
        line.appendChild(text);
        terminal.appendChild(line);
        
        // Auto-scroll to bottom
        terminal.scrollTop = terminal.scrollHeight;
    }
    
    // ✅ NEW: Update progress bar
    updateProgress(percent, message) {
        document.getElementById('deployment-progress-fill').style.width = `${percent}%`;
        document.getElementById('deployment-progress-percent').textContent = `${percent}%`;
        if (message) {
            document.getElementById('deployment-progress-text').textContent = message;
        }
    }
    
    // ✅ NEW: Close deployment modal
    closeDeploymentModal() {
        if (this.deploymentPollInterval) {
            clearInterval(this.deploymentPollInterval);
        }
        document.getElementById('deployment-progress-modal-backdrop').classList.add('hidden');
        this.currentDeployment = null;
    }
    
    // ✅ NEW: Clear terminal output
    clearTerminal() {
        const terminal = document.getElementById('deployment-terminal');
        terminal.innerHTML = '<div class="terminal-line"><span class="terminal-prompt">$</span><span class="terminal-text">Terminal cleared</span></div>';
    }
    
    // ✅ NEW: Cancel deployment
    async cancelDeployment() {
        if (!confirm('Cancel this deployment? The VPS may be left in an incomplete state.')) return;
        
        this.showToast('Deployment cancellation not yet implemented', 'warning');
        // Future: Kill deployment process
    }

    async updateVPS(id) {
        // Update uses the same deployment process with progress modal
        await this.deployVPS(id);
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

    async forceSSL(id) {
        const vps = this.vpsList.find(v => v.id === id);
        if (!vps) return;

        // Show Force SSL modal
        this.showForceSSLModal(id);
    }

    showForceSSLModal(vpsId) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('force-ssl-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'force-ssl-modal';
            modal.className = 'modal-backdrop hidden';
            modal.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <h2>Force SSL Certificate</h2>
                        <button class="modal-close" onclick="app.closeForceSSLModal()">&times;</button>
                    </div>
                    <div class="modal-content">
                        <div class="form-group">
                            <label for="force-ssl-phishlet">Phishlet Name</label>
                            <input type="text" id="force-ssl-phishlet" placeholder="e.g., icloud, google, microsoft">
                            <small style="color: var(--text-muted);">Enter the phishlet name to regenerate SSL certificates for</small>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="app.closeForceSSLModal()">Cancel</button>
                        <button class="btn btn-warning" id="force-ssl-submit">Regenerate SSL</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Store VPS ID and show modal
        this.forceSSLVpsId = vpsId;
        document.getElementById('force-ssl-phishlet').value = '';
        modal.classList.remove('hidden');

        // Set up submit handler
        document.getElementById('force-ssl-submit').onclick = () => this.submitForceSSL();
        
        // Focus input
        setTimeout(() => document.getElementById('force-ssl-phishlet').focus(), 100);
    }

    closeForceSSLModal() {
        const modal = document.getElementById('force-ssl-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    async submitForceSSL() {
        const phishlet = document.getElementById('force-ssl-phishlet').value.trim();
        
        if (!phishlet) {
            this.showToast('Phishlet name is required', 'warning');
            return;
        }

        this.closeForceSSLModal();

        try {
            this.showToast('Regenerating SSL certificates...', 'info');
            const response = await this.apiRequest(`/vps/${this.forceSSLVpsId}/force-ssl`, { 
                method: 'POST',
                body: JSON.stringify({ phishlet })
            });
            
            if (response.success) {
                this.showToast(`SSL certificates regenerated for ${phishlet}`, 'success');
            } else {
                this.showToast(response.message || 'Failed to regenerate SSL', 'error');
            }
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

        // Get admin access info (API key and URL)
        let adminAccess = { admin_url: `http://${vps.host}:5555`, api_key: null, instructions: [] };
        try {
            const accessData = await this.apiRequest(`/vps/${id}/admin-access`);
            if (accessData.success && accessData.data) {
                adminAccess = accessData.data;
            }
        } catch (e) {
            console.error('Failed to get admin access info:', e);
        }

        const isDeployed = adminAccess.is_deployed || adminAccess.api_key;
        
        content.innerHTML = `
            <!-- Admin Dashboard Access Section - Highlighted -->
            <div class="details-section admin-access-section ${!isDeployed ? 'not-deployed' : ''}">
                <h4>🎛️ Admin Dashboard Access</h4>
                <div class="admin-access-card">
                    <div class="details-row">
                        <span>Dashboard URL</span>
                        ${isDeployed ? `
                            <a href="${adminAccess.admin_url}" target="_blank" class="admin-link">
                                ${adminAccess.admin_url}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                            </a>
                        ` : `<span class="text-muted">${adminAccess.admin_url} (deploy first)</span>`}
                    </div>
                    <div class="details-row">
                        <span>API Key</span>
                        <div class="api-key-display">
                            ${isDeployed ? `
                                <code id="api-key-value">${adminAccess.api_key}</code>
                                <button class="btn-copy" onclick="app.copyToClipboard('${adminAccess.api_key}', 'API Key')">📋 Copy</button>
                            ` : `
                                <span class="text-muted">⚠️ Deploy Evilginx first to generate API key</span>
                            `}
                        </div>
                    </div>
                    <div class="instructions-box">
                        <strong>${isDeployed ? 'How to Login:' : 'Getting Started:'}</strong>
                        <ol>
                            ${(adminAccess.instructions || [
                                '1. Click the Dashboard URL above',
                                '2. Select "API Key" tab on the login page',
                                '3. Paste the API key and click Sign In'
                            ]).map(i => `<li>${i.replace(/^\d+\.\s*/, '')}</li>`).join('')}
                        </ol>
                    </div>
                </div>
            </div>

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
            // Show testing indicator
            const card = document.querySelector(`.vps-card[data-id="${id}"]`);
            const indicator = card?.querySelector('.connection-indicator');
            if (indicator) {
                indicator.classList.remove('connected', 'disconnected');
                indicator.classList.add('testing');
            }
            
            const data = await this.apiRequest(`/vps/${id}/test-connection`, { method: 'POST' });
            
            if (data.data?.success) {
                this.showToast('Connection successful!', 'success');
                if (indicator) {
                    indicator.classList.remove('testing');
                    indicator.classList.add('connected');
                    indicator.title = 'Connected';
                }
            } else {
                this.showToast(`Connection failed: ${data.data?.error}`, 'error');
                if (indicator) {
                    indicator.classList.remove('testing');
                    indicator.classList.add('disconnected');
                    indicator.title = 'Disconnected';
                }
            }
            
            // Refresh the VPS list to get updated status
            await this.loadVPSList();
        } catch (error) {
            this.showToast(error.message, 'error');
            // Mark as disconnected on error
            const card = document.querySelector(`.vps-card[data-id="${id}"]`);
            const indicator = card?.querySelector('.connection-indicator');
            if (indicator) {
                indicator.classList.remove('testing');
                indicator.classList.add('disconnected');
                indicator.title = 'Disconnected';
            }
        }
    }
    
    // ✅ NEW: Periodic connection check for all VPS (persistent monitoring)
    startConnectionMonitor() {
        // Check connection status every 30 seconds
        setInterval(() => {
            if (this.currentPage === 'vps' || this.currentPage === 'overview') {
                this.checkAllVPSStatus();
            }
        }, 30000);
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

    copyToClipboard(text, label = 'Text') {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast(`${label} copied to clipboard!`, 'success');
        }).catch(err => {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                this.showToast(`${label} copied to clipboard!`, 'success');
            } catch (e) {
                this.showToast('Failed to copy', 'error');
            }
            document.body.removeChild(textArea);
        });
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

    // =====================================================
    // USER MANAGEMENT (Admin Only)
    // =====================================================

    async loadUsersList() {
        if (!this.isAdmin()) return;

        try {
            const data = await this.apiRequest('/users');
            const tableBody = document.getElementById('users-table');
            tableBody.innerHTML = '';

            if (data.data.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No users found</td></tr>';
                return;
            }

            data.data.forEach(user => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${this.escapeHtml(user.username)}</td>
                    <td>${this.escapeHtml(user.email)}</td>
                    <td><span class="badge badge-${user.status === 'active' ? 'success' : 'error'}">${user.status}</span></td>
                    <td>${user.plan_name || 'None'}</td>
                    <td>${user.vps_count || 0}</td>
                    <td>${new Date(user.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-secondary" onclick="app.resetUserPassword('${user.id}', '${this.escapeHtml(user.username)}')" title="Reset Password">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a7 7 0 00-14 0v2"/></svg>
                        </button>
                        ${user.status === 'active' ? 
                            `<button class="btn btn-sm btn-warning" onclick="app.suspendUser('${user.id}')" title="Suspend">
                                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            </button>` :
                            `<button class="btn btn-sm btn-success" onclick="app.activateUser('${user.id}')" title="Activate">
                                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            </button>`
                        }
                        ${user.id !== this.user.id ? 
                            `<button class="btn btn-sm btn-error" onclick="app.deleteUser('${user.id}', '${this.escapeHtml(user.username)}')" title="Delete">
                                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                            </button>` : ''
                        }
                    </td>
                `;
                tableBody.appendChild(row);
            });
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    showCreateUserModal() {
        if (!this.isAdmin()) {
            this.showToast('Admin access required', 'error');
            return;
        }
        document.getElementById('create-user-modal-backdrop').classList.remove('hidden');
    }

    closeCreateUserModal() {
        document.getElementById('create-user-modal-backdrop').classList.add('hidden');
        document.getElementById('create-user-form').reset();
    }

    async createUser() {
        if (!this.isAdmin()) return;

        const username = document.getElementById('new-user-username').value;
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;
        const fullName = document.getElementById('new-user-fullname').value;
        const companyName = document.getElementById('new-user-company').value;
        const emailVerified = document.getElementById('new-user-verified').checked;
        const status = document.getElementById('new-user-status').value;

        if (!username || !email || !password) {
            this.showToast('Username, email, and password are required', 'error');
            return;
        }

        if (password.length < 12) {
            this.showToast('Password must be at least 12 characters', 'error');
            return;
        }

        try {
            const data = await this.apiRequest('/users', {
                method: 'POST',
                body: JSON.stringify({
                    username, email, password, fullName, companyName, emailVerified, status
                })
            });

            this.showToast('User created successfully!', 'success');
            this.closeCreateUserModal();
            this.loadUsersList();

            // Show temporary password
            if (data.data.temporaryPassword) {
                alert(`User created!\n\nUsername: ${username}\nEmail: ${email}\nTemporary Password: ${data.data.temporaryPassword}\n\nPlease share these credentials with the user.`);
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async suspendUser(userId) {
        if (!confirm('Are you sure you want to suspend this user?')) return;

        try {
            await this.apiRequest(`/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'suspended' })
            });
            this.showToast('User suspended', 'success');
            this.loadUsersList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async activateUser(userId) {
        try {
            await this.apiRequest(`/users/${userId}`, {
                method: 'PUT',
                body: JSON.stringify({ status: 'active' })
            });
            this.showToast('User activated', 'success');
            this.loadUsersList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async deleteUser(userId, username) {
        if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) return;

        try {
            await this.apiRequest(`/users/${userId}`, { method: 'DELETE' });
            this.showToast('User deleted', 'success');
            this.loadUsersList();
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async resetUserPassword(userId, username) {
        if (!confirm(`Reset password for user "${username}"?`)) return;

        try {
            const data = await this.apiRequest(`/users/${userId}/reset-password`, { method: 'POST' });
            if (data.data?.temporaryPassword) {
                alert(`Password reset successfully!\n\nNew temporary password: ${data.data.temporaryPassword}\n\nPlease share this with the user.`);
            }
            this.showToast('Password reset successfully', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    // =====================================================
    // GITHUB / DEPLOYMENT SETTINGS (Admin Only)
    // =====================================================

    async loadGitHubSettings() {
        if (!this.isAdmin()) return;
        
        try {
            const data = await this.apiRequest('/github/settings');
            if (data.data) {
                const settings = data.data;
                const dockerImageEl = document.getElementById('docker-image');
                const repoEl = document.getElementById('github-repo');
                const branchEl = document.getElementById('github-branch');
                const autoUpdateEl = document.getElementById('github-auto-update');
                const secretEl = document.getElementById('github-secret');
                const webhookUrlEl = document.getElementById('github-webhook-url');
                
                if (dockerImageEl) dockerImageEl.value = settings.docker_image || '';
                if (repoEl) repoEl.value = settings.repo_url || '';
                if (branchEl) branchEl.value = settings.branch || 'main';
                if (autoUpdateEl) autoUpdateEl.checked = !!settings.auto_update;
                if (secretEl) secretEl.value = settings.secret || '';
                if (webhookUrlEl) webhookUrlEl.value = `${this.apiBase}/github/webhook`;
            }
        } catch (error) {
            console.error('Failed to load GitHub settings:', error);
        }
    }

    async saveGitHubSettings() {
        if (!this.isAdmin()) {
            this.showToast('Access denied: Admin privileges required', 'error');
            return;
        }

        try {
            const dockerImage = document.getElementById('docker-image')?.value?.trim();
            const repoUrl = document.getElementById('github-repo')?.value?.trim();
            const branch = document.getElementById('github-branch')?.value?.trim() || 'main';
            const autoUpdate = document.getElementById('github-auto-update')?.checked || false;

            // Validate - need either docker image or repo URL
            if (!dockerImage && !repoUrl) {
                this.showToast('Please provide a Docker image OR repository URL', 'warning');
                return;
            }

            await this.apiRequest('/github/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    docker_image: dockerImage || null,
                    repo_url: repoUrl || null,
                    branch: branch,
                    auto_update: autoUpdate
                })
            });

            this.showToast('Deployment settings saved successfully!', 'success');
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }

    async regenerateWebhookSecret() {
        if (!this.isAdmin()) {
            this.showToast('Access denied: Admin privileges required', 'error');
            return;
        }

        if (!confirm('Regenerate webhook secret? You will need to update this in GitHub.')) return;

        try {
            const data = await this.apiRequest('/github/regenerate-secret', { method: 'POST' });
            if (data.data?.secret) {
                document.getElementById('github-secret').value = data.data.secret;
                this.showToast('Webhook secret regenerated! Update this in GitHub.', 'success');
            }
        } catch (error) {
            this.showToast(error.message, 'error');
        }
    }


    // =====================================================
    // BUILDS MANAGEMENT
    // =====================================================

    async loadBuilds() {
        try {
            const result = await this.apiRequest('/upload/evilginx-builds');
            const tbody = document.getElementById('builds-table-body');
            
            if (!result.success || result.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No builds uploaded yet</td></tr>';
                return;
            }

            tbody.innerHTML = result.data.map(build => {
                const sizeM = (build.size / (1024 * 1024)).toFixed(2);
                const date = new Date(build.uploadedAt).toLocaleString();
                const statusBadge = build.isActive 
                    ? '<span class="badge badge-success">✅ Active</span>'
                    : '<span class="badge badge-muted">Inactive</span>';
                
                return `
                    <tr>
                        <td>${statusBadge}</td>
                        <td><strong>${this.escapeHtml(build.version)}</strong></td>
                        <td>${this.escapeHtml(build.description || '-')}</td>
                        <td>${sizeM} MB</td>
                        <td>${this.escapeHtml(build.uploadedBy?.username || 'N/A')}</td>
                        <td>${date}</td>
                        <td>
                            <div class="table-actions">
                                ${!build.isActive ? `
                                    <button class="btn-icon success" onclick="app.activateBuild('${build.id}')" title="Activate">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                    </button>
                                ` : ''}
                                ${!build.isActive ? `
                                    <button class="btn-icon danger" onclick="app.deleteBuild('${build.id}')" title="Delete">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                        </svg>
                                    </button>
                                ` : '<span class="text-muted">Active build</span>'}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (error) {
            console.error('Load builds error:', error);
            document.getElementById('builds-table-body').innerHTML = 
                '<tr><td colspan="7" class="text-center text-danger">Failed to load builds</td></tr>';
        }
    }

    async uploadBuild(formData) {
        const progressDiv = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const form = document.getElementById('upload-build-form');

        try {
            progressDiv.style.display = 'block';
            form.style.display = 'none';

            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    progressFill.style.width = percent + '%';
                    progressText.textContent = `Uploading... ${percent.toFixed(1)}%`;
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status === 200) {
                    const result = JSON.parse(xhr.responseText);
                    if (result.success) {
                        this.toast('success', 'Success', 'Build uploaded successfully');
                        form.reset();
                        this.loadBuilds();
                    } else {
                        this.toast('error', 'Error', result.message);
                    }
                } else {
                    this.toast('error', 'Error', 'Upload failed: ' + xhr.statusText);
                }
                progressDiv.style.display = 'none';
                form.style.display = 'block';
            });

            xhr.addEventListener('error', () => {
                this.toast('error', 'Error', 'Upload failed - network error');
                progressDiv.style.display = 'none';
                form.style.display = 'block';
            });

            xhr.open('POST', '/api/upload/evilginx-build');
            xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            xhr.send(formData);

        } catch (error) {
            console.error('Upload error:', error);
            this.toast('error', 'Error', error.message);
            progressDiv.style.display = 'none';
            form.style.display = 'block';
        }
    }

    async activateBuild(buildId) {
        if (!confirm('Activate this build? It will be used for all future deployments.')) {
            return;
        }

        try {
            const result = await this.apiRequest(`/upload/evilginx-builds/${buildId}/activate`, {
                method: 'POST'
            });

            if (result.success) {
                this.toast('success', 'Success', 'Build activated');
                this.loadBuilds();
            } else {
                this.toast('error', 'Error', result.message);
            }
        } catch (error) {
            this.toast('error', 'Error', error.message);
        }
    }

    async deleteBuild(buildId) {
        if (!confirm('Delete this build? This action cannot be undone.')) {
            return;
        }

        try {
            const result = await this.apiRequest(`/upload/evilginx-builds/${buildId}`, {
                method: 'DELETE'
            });

            if (result.success) {
                this.toast('success', 'Success', 'Build deleted');
                this.loadBuilds();
            } else {
                this.toast('error', 'Error', result.message);
            }
        } catch (error) {
            this.toast('error', 'Error', error.message);
        }
    }

    initBuildsPage() {
        // Upload form handler
        const uploadForm = document.getElementById('upload-build-form');
        if (uploadForm) {
            uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const version = document.getElementById('build-version').value;
                const description = document.getElementById('build-description').value;
                const fileInput = document.getElementById('build-file');
                const file = fileInput.files[0];

                if (!file) {
                    this.toast('error', 'Error', 'Please select a file');
                    return;
                }

                // Validate file size (500MB max)
                const maxSize = 500 * 1024 * 1024;
                if (file.size > maxSize) {
                    this.toast('error', 'Error', 'File too large. Maximum size is 500MB.');
                    return;
                }

                const formData = new FormData();
                formData.append('file', file);
                formData.append('version', version);
                formData.append('description', description);

                await this.uploadBuild(formData);
            });
        }

        // Load builds when page is opened
        this.loadBuilds();
    }


}

// Initialize app
const app = new ManagementApp();



