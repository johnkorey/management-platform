const Database = require('better-sqlite3');
const db = new Database('./data/evilginx.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);

for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
    console.log(`\n${table.name} columns:`, columns.map(c => c.name).join(', '));
}

db.close();

