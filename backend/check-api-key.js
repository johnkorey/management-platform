const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'evilginx_management.db');
console.log('DB Path:', dbPath);
console.log('DB Size:', fs.statSync(dbPath).size, 'bytes');

const db = new Database(dbPath);

try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables.map(t => t.name).join(', '));
    
    if (tables.some(t => t.name === 'vps_instances')) {
        const vps = db.prepare('SELECT id, name, host, admin_api_key, is_deployed FROM vps_instances').all();
        console.log('\nVPS Instances:');
        vps.forEach(v => {
            console.log(`  - ${v.name} (${v.host})`);
            console.log(`    Deployed: ${v.is_deployed}`);
            console.log(`    API Key: ${v.admin_api_key || 'NOT SET'}`);
        });
    }
} catch (e) {
    console.error('Error:', e.message);
}

db.close();

