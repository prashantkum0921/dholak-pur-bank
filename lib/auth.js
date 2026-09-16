const jwt = require('jsonwebtoken');
const { query } = require('./db');
const { hashToken } = require('./encryption');
const { logAudit } = require('./audit');

function generateAccessToken(user) {
    return jwt.sign(
        { userId: user.id, username: user.username, role: user.role || 'user' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.SESSION_EXPIRY ? `${process.env.SESSION_EXPIRY}s` : '15m' }
    );
}

function generateRefreshToken() {
    const crypto = require('crypto');
    return crypto.randomBytes(40).toString('hex');
}

async function storeRefreshToken(userId, refreshToken, deviceInfo, ipAddress) {
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + (parseInt(process.env.REFRESH_EXPIRY) || 604800) * 1000);
    await query(
        `INSERT INTO sessions (user_id, refresh_token_hash, device_info, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
        [userId, tokenHash, deviceInfo || 'unknown', ipAddress || 'unknown', expiresAt.toISOString()]
    );
    return tokenHash;
}

async function validateRefreshToken(refreshToken) {
    const tokenHash = hashToken(refreshToken);
    const rows = await query(
        `SELECT s.*, u.is_locked, u.username FROM sessions s 
     JOIN users u ON s.user_id = u.id
     WHERE s.refresh_token_hash = $1 AND s.is_revoked = FALSE AND s.expires_at > NOW()`,
        [tokenHash]
    );
    if (rows.length === 0) return null;
    return rows[0];
}

async function rotateRefreshToken(oldToken, userId, deviceInfo, ipAddress) {
    // Revoke old token
    const oldHash = hashToken(oldToken);
    await query(`UPDATE sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1`, [oldHash]);
    // Issue new one
    const newToken = generateRefreshToken();
    await storeRefreshToken(userId, newToken, deviceInfo, ipAddress);
    return newToken;
}

async function revokeAllUserSessions(userId) {
    await query(`UPDATE sessions SET is_revoked = TRUE WHERE user_id = $1`, [userId]);
}

// Middleware: authenticate JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
}

// Middleware: check user is not locked
async function checkAccountLock(req, res, next) {
    if (!req.user || !req.user.userId) return next();
    try {
        const rows = await query(`SELECT is_locked, lock_reason FROM users WHERE id = $1`, [req.user.userId]);
        if (rows.length > 0 && rows[0].is_locked) {
            return res.status(423).json({
                error: 'Account is locked',
                reason: rows[0].lock_reason || 'Suspicious activity detected'
            });
        }
        next();
    } catch (err) {
        next(err);
    }
}

// Middleware: admin check
function requireAdmin(req, res, next) {
    if (!req.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    storeRefreshToken,
    validateRefreshToken,
    rotateRefreshToken,
    revokeAllUserSessions,
    authenticateToken,
    checkAccountLock,
    requireAdmin
};
