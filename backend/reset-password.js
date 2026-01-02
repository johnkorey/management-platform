const bcrypt = require('bcrypt');
const pool = require('./db');

async function resetPassword() {
    const newPassword = 'Admin@123';
    const hash = await bcrypt.hash(newPassword, 12);

    try {
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE email = $2',
            [hash, 'admin@evilginx.local']
        );

        console.log('');
        console.log('========================================');
        console.log('  PASSWORD RESET SUCCESSFUL');
        console.log('========================================');
        console.log('');
        console.log('  Email:    admin@evilginx.local');
        console.log('  Password: ' + newPassword);
        console.log('');
        console.log('  Rows affected:', result.rowCount);
        console.log('========================================');
        console.log('');
        
        process.exit(0);
    } catch (error) {
        console.error('Password reset failed:', error);
        process.exit(1);
    }
}

resetPassword();
