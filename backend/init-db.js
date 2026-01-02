// Database Initialization Script
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

async function initDatabase() {
    try {
        console.log('🔗 Connecting to DigitalOcean PostgreSQL...');
        
        // Test connection
        const testResult = await pool.query('SELECT version()');
        console.log('✅ Connected to PostgreSQL:', testResult.rows[0].version.split(' ').slice(0, 2).join(' '));
        
        // Read main schema file
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📄 Executing schema.sql...');
        await pool.query(schema);
        
        // Read VPS schema file
        const vpsSchemaPath = path.join(__dirname, '../database/vps_schema.sql');
        if (fs.existsSync(vpsSchemaPath)) {
            const vpsSchema = fs.readFileSync(vpsSchemaPath, 'utf8');
            console.log('📄 Executing vps_schema.sql...');
            await pool.query(vpsSchema);
        }
        
        console.log('✅ Database initialized successfully!');
        console.log('');
        console.log('📊 Created:');
        console.log('   - Core tables (users, subscriptions, instances, sessions, etc.)');
        console.log('   - VPS management tables (vps_instances, deployments, etc.)');
        console.log('   - Indexes and constraints');
        console.log('   - Views for queries');
        console.log('   - 1 subscription plan ($250/month unlimited)');
        console.log('   - 2 test users');
        console.log('   - GitHub webhook settings');
        console.log('');
        console.log('🎉 Database ready for use!');
        
        await pool.end();
        
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        process.exit(1);
    }
}

initDatabase();

