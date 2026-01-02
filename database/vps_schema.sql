-- =====================================================
-- VPS Deployment System - Additional Schema
-- =====================================================

-- =====================================================
-- VPS INSTANCES (User's Servers)
-- =====================================================

CREATE TABLE IF NOT EXISTS vps_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Connection Details
    host VARCHAR(255) NOT NULL,
    port INTEGER DEFAULT 22,
    username VARCHAR(100) NOT NULL,
    auth_type VARCHAR(20) DEFAULT 'password' CHECK (auth_type IN ('password', 'key')),
    password_encrypted TEXT,
    ssh_key_encrypted TEXT,
    
    -- Status
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'connecting', 'connected', 'deploying', 'running', 'stopped', 'error', 'offline')),
    last_error TEXT,
    
    -- Deployment Info
    is_deployed BOOLEAN DEFAULT FALSE,
    deployed_version VARCHAR(100),
    deployed_at TIMESTAMP,
    github_repo VARCHAR(255) DEFAULT 'https://github.com/yourusername/evilginx2.git',
    github_branch VARCHAR(100) DEFAULT 'main',
    install_path VARCHAR(255) DEFAULT '/opt/evilginx',
    
    -- Runtime Info
    pid INTEGER,
    uptime_seconds BIGINT,
    last_heartbeat TIMESTAMP,
    system_info JSONB, -- {"os": "Ubuntu 22.04", "cpu": "2 cores", "memory": "4GB", "disk": "50GB"}
    
    -- Evilginx Config
    evilginx_port INTEGER DEFAULT 8443,
    admin_port INTEGER DEFAULT 8888,
    api_key VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints: Max 2 VPS per user
    UNIQUE(user_id, name)
);

-- Trigger to enforce max 2 VPS per user
CREATE OR REPLACE FUNCTION check_max_vps()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM vps_instances WHERE user_id = NEW.user_id) >= 2 THEN
        RAISE EXCEPTION 'Maximum 2 VPS instances allowed per user';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_max_vps ON vps_instances;
CREATE TRIGGER enforce_max_vps
    BEFORE INSERT ON vps_instances
    FOR EACH ROW
    EXECUTE FUNCTION check_max_vps();

CREATE INDEX idx_vps_user ON vps_instances(user_id);
CREATE INDEX idx_vps_status ON vps_instances(status);

-- =====================================================
-- DEPLOYMENTS (Deployment History)
-- =====================================================

CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Deployment Details
    type VARCHAR(30) NOT NULL CHECK (type IN ('initial', 'update', 'rollback', 'restart', 'stop', 'start')),
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'success', 'failed', 'cancelled')),
    
    -- Version Info
    from_version VARCHAR(100),
    to_version VARCHAR(100),
    git_commit VARCHAR(50),
    
    -- Execution Details
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    duration_seconds INTEGER,
    
    -- Logs
    logs TEXT,
    error_message TEXT,
    
    -- Triggered By
    triggered_by VARCHAR(50) DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'webhook', 'auto', 'system')),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_deployments_vps ON deployments(vps_id);
CREATE INDEX idx_deployments_user ON deployments(user_id);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_deployments_created ON deployments(created_at);

-- =====================================================
-- DEPLOYMENT LOGS (Real-time Logs)
-- =====================================================

CREATE TABLE IF NOT EXISTS deployment_logs (
    id BIGSERIAL PRIMARY KEY,
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    level VARCHAR(20) DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
    message TEXT NOT NULL,
    metadata JSONB
);

CREATE INDEX idx_deployment_logs_deployment ON deployment_logs(deployment_id);
CREATE INDEX idx_deployment_logs_timestamp ON deployment_logs(timestamp);

-- =====================================================
-- GITHUB WEBHOOK SETTINGS
-- =====================================================

CREATE TABLE IF NOT EXISTS github_webhook_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    secret_token VARCHAR(255) UNIQUE NOT NULL,
    repo_url VARCHAR(255) NOT NULL,
    branch VARCHAR(100) DEFAULT 'main',
    auto_update_enabled BOOLEAN DEFAULT TRUE,
    last_push_at TIMESTAMP,
    last_push_commit VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default webhook settings (generate random secret)
INSERT INTO github_webhook_settings (secret_token, repo_url, branch) 
VALUES (encode(gen_random_bytes(32), 'hex'), 'https://github.com/yourusername/evilginx2.git', 'main')
ON CONFLICT DO NOTHING;

-- =====================================================
-- VPS HEARTBEAT HISTORY
-- =====================================================

CREATE TABLE IF NOT EXISTS vps_heartbeats (
    id BIGSERIAL PRIMARY KEY,
    vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20),
    cpu_usage DECIMAL(5,2),
    memory_usage DECIMAL(5,2),
    disk_usage DECIMAL(5,2),
    evilginx_running BOOLEAN,
    sessions_count INTEGER,
    metadata JSONB
);

CREATE INDEX idx_heartbeats_vps ON vps_heartbeats(vps_id);
CREATE INDEX idx_heartbeats_timestamp ON vps_heartbeats(timestamp);

-- Cleanup old heartbeats (keep last 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_heartbeats()
RETURNS void AS $$
BEGIN
    DELETE FROM vps_heartbeats WHERE timestamp < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- UPDATE TRIGGERS
-- =====================================================

CREATE TRIGGER update_vps_updated_at 
    BEFORE UPDATE ON vps_instances 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhook_settings_updated_at 
    BEFORE UPDATE ON github_webhook_settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS
-- =====================================================

-- VPS Dashboard View
CREATE OR REPLACE VIEW vps_dashboard AS
SELECT 
    v.id,
    v.user_id,
    v.name,
    v.host,
    v.status,
    v.is_deployed,
    v.deployed_version,
    v.deployed_at,
    v.last_heartbeat,
    v.uptime_seconds,
    v.system_info,
    u.username,
    u.email,
    (SELECT COUNT(*) FROM deployments d WHERE d.vps_id = v.id) as total_deployments,
    (SELECT MAX(finished_at) FROM deployments d WHERE d.vps_id = v.id AND d.status = 'success') as last_successful_deploy
FROM vps_instances v
JOIN users u ON v.user_id = u.id;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE vps_instances IS 'User VPS instances for Evilginx deployment (max 2 per user)';
COMMENT ON TABLE deployments IS 'Deployment history and status for all VPS instances';
COMMENT ON TABLE deployment_logs IS 'Real-time logs during deployment process';
COMMENT ON TABLE github_webhook_settings IS 'GitHub webhook configuration for auto-updates';
COMMENT ON TABLE vps_heartbeats IS 'VPS health monitoring data';

