const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../lib/db');
const { logAudit } = require('../lib/audit');
const { rateLimitMiddleware } = require('../lib/rate-limiter');

// Simple admin auth middleware (separate from user auth)
function adminAuth(req, res, next) {
    const adminToken = req.headers['x-admin-token'];
    if (!adminToken) {
        return res.status(401).json({ error: 'Admin authentication required' });
    }

    const expectedHash = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest('hex');
    const providedHash = crypto.createHash('sha256').update(adminToken).digest('hex');

    if (expectedHash !== providedHash) {
        return res.status(403).json({ error: 'Invalid admin credentials' });
    }

    req.isAdmin = true;
    next();
}

// POST /api/admin/login (rate limited)
router.post('/login', rateLimitMiddleware('login'), async (req, res) => {
    try {
        const { password } = req.body;
        const adminPwd = process.env.ADMIN_PASSWORD;

        // Debug logging (safe: only logs lengths and prefixes)
        console.log('[ADMIN LOGIN DEBUG]', {
            submittedLength: password?.length,
            expectedLength: adminPwd?.length,
            submittedPrefix: password?.substring(0, 3),
            expectedPrefix: adminPwd?.substring(0, 3),
            envVarSet: !!adminPwd,
            match: password === adminPwd
        });

        if (!password || password !== adminPwd) {
            await logAudit(null, 'admin_login_failed', req, {}, 'warning');
            return res.status(401).json({ error: 'Invalid admin credentials' });
        }

        await logAudit(null, 'admin_login_success', req);

        res.json({
            message: 'Admin login successful',
            adminToken: process.env.ADMIN_PASSWORD // In production, use a proper token
        });
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ error: 'Admin login failed' });
    }
});

// GET /api/admin/dashboard — Aggregated security overview
router.get('/dashboard', adminAuth, async (req, res) => {
    try {
        const [
            totalUsers,
            lockedAccounts,
            recentTransactions,
            fraudEvents,
            honeypotHits,
            rateLimitBreaches,
            recentAnomalies
        ] = await Promise.all([
            query(`SELECT COUNT(*) as cnt FROM users`),
            query(`SELECT COUNT(*) as cnt FROM users WHERE is_locked = TRUE`),
            query(`SELECT COUNT(*) as cnt FROM transactions WHERE created_at > NOW() - INTERVAL '24 hours'`),
            query(`SELECT COUNT(*) as cnt FROM fraud_events WHERE resolved = FALSE`),
            query(`SELECT COUNT(*) as cnt FROM honeypot_triggers WHERE created_at > NOW() - INTERVAL '24 hours'`),
            query(`SELECT COUNT(*) as cnt FROM rate_limit_events WHERE created_at > NOW() - INTERVAL '24 hours'`),
            query(`SELECT COUNT(*) as cnt FROM login_anomalies WHERE created_at > NOW() - INTERVAL '24 hours'`)
        ]);

        res.json({
            overview: {
                totalUsers: parseInt(totalUsers[0]?.cnt || 0),
                lockedAccounts: parseInt(lockedAccounts[0]?.cnt || 0),
                transactionsLast24h: parseInt(recentTransactions[0]?.cnt || 0),
                unresolvedFraudEvents: parseInt(fraudEvents[0]?.cnt || 0),
                honeypotTriggersLast24h: parseInt(honeypotHits[0]?.cnt || 0),
                rateLimitBreachesLast24h: parseInt(rateLimitBreaches[0]?.cnt || 0),
                loginAnomaliesLast24h: parseInt(recentAnomalies[0]?.cnt || 0)
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

// GET /api/admin/suspicious-logins
router.get('/suspicious-logins', adminAuth, async (req, res) => {
    try {
        const anomalies = await query(
            `SELECT la.*, u.username, u.email 
       FROM login_anomalies la
       LEFT JOIN users u ON la.user_id = u.id
       ORDER BY la.created_at DESC LIMIT 50`
        );
        res.json({ anomalies });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load suspicious logins' });
    }
});

// GET /api/admin/flagged-transactions
router.get('/flagged-transactions', adminAuth, async (req, res) => {
    try {
        const transactions = await query(
            `SELECT t.*, fu.username as from_username, tu.username as to_username
       FROM transactions t
       LEFT JOIN users fu ON t.from_user_id = fu.id
       LEFT JOIN users tu ON t.to_user_id = tu.id
       WHERE t.status = 'flagged' OR t.metadata->>'riskScore' IS NOT NULL
       ORDER BY t.created_at DESC LIMIT 50`
        );
        res.json({
            transactions: transactions.map(t => ({
                ...t,
                amount: parseFloat(t.amount_plain),
                riskScore: t.metadata?.riskScore
            }))
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load flagged transactions' });
    }
});

// GET /api/admin/ip-abuse
router.get('/ip-abuse', adminAuth, async (req, res) => {
    try {
        const abuse = await query(
            `SELECT ip_address, COUNT(*) as total_hits, MAX(created_at) as last_seen
       FROM rate_limit_events
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY ip_address
       ORDER BY total_hits DESC LIMIT 30`
        );

        const honeypotAbuse = await query(
            `SELECT ip_address, COUNT(*) as trigger_count, 
              array_agg(DISTINCT endpoint) as endpoints, MAX(created_at) as last_seen
       FROM honeypot_triggers
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY ip_address
       ORDER BY trigger_count DESC LIMIT 20`
        );

        res.json({ rateLimitAbuse: abuse, honeypotAbuse });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load IP abuse data' });
    }
});

// GET /api/admin/fraud-alerts
router.get('/fraud-alerts', adminAuth, async (req, res) => {
    try {
        const alerts = await query(
            `SELECT fe.*, u.username
       FROM fraud_events fe
       LEFT JOIN users u ON fe.user_id = u.id
       WHERE fe.resolved = FALSE
       ORDER BY 
         CASE fe.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         fe.created_at DESC
       LIMIT 50`
        );
        res.json({ alerts });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load fraud alerts' });
    }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', adminAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;
        const severityFilter = req.query.severity;

        let queryStr = `SELECT al.*, u.username FROM audit_logs al 
                    LEFT JOIN users u ON al.user_id = u.id`;
        const params = [];

        if (severityFilter && ['info', 'warning', 'critical', 'alert'].includes(severityFilter)) {
            queryStr += ` WHERE al.severity = $1`;
            params.push(severityFilter);
        }

        queryStr += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const logs = await query(queryStr, params);
        res.json({ logs, page, limit });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load audit logs' });
    }
});

// POST /api/admin/freeze-account
router.post('/freeze-account', adminAuth, async (req, res) => {
    try {
        const { userId, reason } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        await query(
            `UPDATE users SET is_locked = TRUE, lock_reason = $1 WHERE id = $2`,
            [reason || 'Frozen by admin', userId]
        );

        // Revoke all sessions
        await query(`UPDATE sessions SET is_revoked = TRUE WHERE user_id = $1`, [userId]);

        await logAudit(null, 'admin_freeze_account', req, { targetUserId: userId, reason }, 'critical');

        res.json({ message: 'Account frozen successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to freeze account' });
    }
});

// POST /api/admin/unfreeze-account
router.post('/unfreeze-account', adminAuth, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        await query(
            `UPDATE users SET is_locked = FALSE, lock_reason = NULL, failed_login_count = 0 WHERE id = $1`,
            [userId]
        );

        await logAudit(null, 'admin_unfreeze_account', req, { targetUserId: userId }, 'warning');

        res.json({ message: 'Account unfrozen successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to unfreeze account' });
    }
});

// GET /api/admin/users
router.get('/users', adminAuth, async (req, res) => {
    try {
        const users = await query(
            `SELECT u.id, u.username, u.email, u.is_locked, u.lock_reason, u.failed_login_count, 
              u.created_at, u.last_known_ip
       FROM users u ORDER BY u.created_at DESC LIMIT 100`
        );
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// GET /api/admin/blocked-users — List only blocked/locked accounts
router.get('/blocked-users', adminAuth, async (req, res) => {
    try {
        const users = await query(
            `SELECT u.id, u.username, u.email, u.is_locked, u.lock_reason, u.failed_login_count,
              u.created_at, u.last_known_ip, u.updated_at
       FROM users u WHERE u.is_locked = TRUE ORDER BY u.updated_at DESC LIMIT 100`
        );
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load blocked users' });
    }
});

module.exports = router;
