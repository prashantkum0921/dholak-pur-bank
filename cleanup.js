require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function cleanup() {
    // Clear all rate limit events to unblock IP
    await sql('DELETE FROM rate_limit_events', []);
    console.log('✅ Rate limit events cleared');

    // Clear all used/expired OTP records
    await sql("DELETE FROM otp_records WHERE is_used = TRUE OR expires_at < NOW()", []);
    console.log('✅ Old OTP records cleared');

    // List all users and their locked status
    const users = await sql('SELECT id, username, is_locked FROM users', []);
    if (users.length === 0) {
        console.log('No users in DB yet');
    } else {
        console.log('Users in DB:');
        users.forEach(u => console.log(`  - ${u.username} | locked: ${u.is_locked}`));
    }

    // Unlock any accidentally locked users
    await sql('UPDATE users SET is_locked = FALSE, lock_reason = NULL, failed_login_count = 0 WHERE failed_login_count >= 5 AND is_locked = TRUE', []);
    console.log('✅ Unlocked any over-locked accounts');
}

cleanup().then(() => {
    console.log('✅ Cleanup complete!');
    process.exit(0);
}).catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
