// VPS Schema Initialization Script
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: 'db-postgresql-sfo2-29443-do-user-30990058-0.h.db.ondigitalocean.com',
    port: 25060,
    database: 'defaultdb',
    user: 'doadmin',
    password: process.env.DB_PASSWORD || 'YOUR_DB_PASSWORD_HERE',
    ssl: { rejectUnauthorized: false }
});

async function initVPSSchema() {
    try {
        console.log('🔗 Connecting to DigitalOcean PostgreSQL...');
        
        // Test connection
        const testResult = await pool.query('SELECT version()');
        console.log('✅ Connected to PostgreSQL:', testResult.rows[0].version.split(' ').slice(0, 2).join(' '));
        
        // Read VPS schema file
        const vpsSchemaPath = path.join(__dirname, '../database/vps_schema.sql');
        const vpsSchema = fs.readFileSync(vpsSchemaPath, 'utf8');
        
        console.log('📄 Executing vps_schema.sql...');
        
        // Execute schema
        await pool.query(vpsSchema);
        
        console.log('✅ VPS schema initialized successfully!');
        console.log('');
        console.log('📊 Created:');
        console.log('   - vps_instances table (max 2 per user)');
        console.log('   - deployments table');
        console.log('   - deployment_logs table');
        console.log('   - github_webhook_settings table');
        console.log('   - vps_heartbeats table');
        console.log('   - vps_dashboard view');
        console.log('');
        console.log('🎉 VPS deployment system ready!');
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ VPS schema initialization error:', error.message);
        if (error.message.includes('already exists')) {
            console.log('');
            console.log('ℹ️  Some tables may already exist. This is OK if you\'re re-running the script.');
        }
        process.exit(1);
    }
}

initVPSSchema();

