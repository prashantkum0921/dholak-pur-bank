require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function fixWallets() {
    const { encrypt } = require('./lib/encryption');
    
    // Find users without wallets
    const usersWithoutWallet = await sql(`
        SELECT u.id, u.username FROM users u
        LEFT JOIN wallets w ON u.id = w.user_id
        WHERE w.id IS NULL
    `);
    
    console.log(`Users without wallets: ${usersWithoutWallet.length}`);
    
    for (const user of usersWithoutWallet) {
        const initialBalance = encrypt('1000.00');
        await sql(`INSERT INTO wallets (user_id, balance_encrypted) VALUES (${user.id}, '${initialBalance}')`);
        console.log(`✅ Created wallet for user: ${user.username}`);
    }
    
    console.log('Done!');
}

fixWallets().catch(e => console.error(e.message));
