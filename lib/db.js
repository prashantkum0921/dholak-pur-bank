const { neon } = require('@neondatabase/serverless');

let sql;

function getDb() {
    if (!sql) {
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL environment variable is required');
        }
        sql = neon(process.env.DATABASE_URL);
    }
    return sql;
}

/**
 * Execute a parameterized query using Neon's HTTP driver.
 * Uses traditional (text, params) style for compatibility.
 */
async function query(text, params = []) {
    const db = getDb();
    try {
        const result = await db(text, params);
        return result;
    } catch (err) {
        console.error('Database query error:', { query: text.substring(0, 100), error: err.message });
        throw err;
    }
}

/**
 * Get the raw tagged template sql function.
 * Needed for building transaction query arrays.
 *
 * Usage:
 *   const sql = getTaggedSql();
 *   const results = await sql.transaction([
 *     sql`UPDATE wallets SET ... WHERE user_id = ${userId}`,
 *     sql`UPDATE wallets SET ... WHERE user_id = ${otherUserId}`,
 *     sql`INSERT INTO transactions ...`,
 *   ], { isolationLevel: 'Serializable' });
 */
function getTaggedSql() {
    return getDb();
}

module.exports = { getDb, query, getTaggedSql };

