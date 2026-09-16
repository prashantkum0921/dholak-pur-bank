const { query } = require('./db');
const { logLoginAnomaly, logFraudEvent } = require('./audit');

async function detectLoginAnomalies(userId, req) {
    const anomalies = [];
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const deviceFingerprint = req.body.deviceFingerprint || null;
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Get user's known device and IP
    const user = await query(
        `SELECT device_fingerprint, last_known_ip, last_known_location FROM users WHERE id = $1`,
        [userId]
    );

    if (user.length === 0) return anomalies;
    const userData = user[0];

    // 1. New device detection
    if (userData.device_fingerprint && deviceFingerprint &&
        userData.device_fingerprint !== deviceFingerprint) {
        anomalies.push({
            type: 'new_device',
            severity: 'medium',
            detail: 'Login from unrecognized device'
        });
        await logLoginAnomaly(userId, 'new_device', {
            knownFingerprint: userData.device_fingerprint?.substring(0, 8) + '...',
            newFingerprint: deviceFingerprint?.substring(0, 8) + '...'
        });
    }

    // 2. New IP / location
    if (userData.last_known_ip && ip !== userData.last_known_ip) {
        anomalies.push({
            type: 'new_location',
            severity: 'low',
            detail: `Login from new IP address`
        });
        await logLoginAnomaly(userId, 'new_ip', { oldIp: '***', newIp: ip.substring(0, 8) + '***' });
    }

    // 3. Unusual time check
    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 5) {
        anomalies.push({
            type: 'unusual_time',
            severity: 'low',
            detail: `Login at unusual hour: ${hour}:00`
        });
        await logLoginAnomaly(userId, 'unusual_time', { hour });
    }

    // 4. Check for rapid failed logins recently
    const recentFailed = await query(
        `SELECT COUNT(*) as cnt FROM audit_logs 
     WHERE user_id = $1 AND action = 'login_failed' AND created_at > NOW() - INTERVAL '15 minutes'`,
        [userId]
    );
    if (parseInt(recentFailed[0]?.cnt || 0) >= 3) {
        anomalies.push({
            type: 'post_bruteforce',
            severity: 'high',
            detail: 'Successful login after multiple failed attempts'
        });
        await logLoginAnomaly(userId, 'post_bruteforce_login', {
            failedAttempts: recentFailed[0].cnt
        });
    }

    // 5. Check concurrent active sessions
    const activeSessions = await query(
        `SELECT COUNT(*) as cnt FROM sessions 
     WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()`,
        [userId]
    );
    if (parseInt(activeSessions[0]?.cnt || 0) >= 3) {
        anomalies.push({
            type: 'multiple_sessions',
            severity: 'medium',
            detail: `${activeSessions[0].cnt} active sessions detected`
        });
    }

    return anomalies;
}

async function handleFailedLogin(userId, req) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';

    if (userId) {
        // Increment failed login counter
        const result = await query(
            `UPDATE users SET failed_login_count = failed_login_count + 1, last_failed_login = NOW() 
       WHERE id = $1 RETURNING failed_login_count`,
            [userId]
        );

        const failCount = result[0]?.failed_login_count || 0;

        // Lock account after 5 failed attempts
        if (failCount >= 5) {
            await query(
                `UPDATE users SET is_locked = TRUE, lock_reason = 'Too many failed login attempts' WHERE id = $1`,
                [userId]
            );
            await logFraudEvent(userId, 'account_locked_failed_logins', 'critical', {
                failedAttempts: failCount, ip
            });
            return { locked: true };
        }
    }

    return { locked: false };
}

async function resetFailedLogins(userId) {
    await query(`UPDATE users SET failed_login_count = 0, last_failed_login = NULL WHERE id = $1`, [userId]);
}

module.exports = { detectLoginAnomalies, handleFailedLogin, resetFailedLogins };
