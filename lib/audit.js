const { query } = require('./db');

async function logAudit(userId, action, req, details = {}, severity = 'info') {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.ip || 'unknown') : 'system';
        const userAgent = req ? (req.headers['user-agent'] || 'unknown') : 'system';
        await query(
            `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, details, severity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, action, ipAddress, userAgent, JSON.stringify(details), severity]
        );
    } catch (err) {
        console.error('Audit log write failed:', err.message);
    }
}

async function logFraudEvent(userId, eventType, severity, details = {}) {
    try {
        await query(
            `INSERT INTO fraud_events (user_id, event_type, severity, details)
       VALUES ($1, $2, $3, $4)`,
            [userId, eventType, severity, JSON.stringify(details)]
        );
    } catch (err) {
        console.error('Fraud event log failed:', err.message);
    }
}

async function logHoneypotTrigger(req, endpoint) {
    try {
        const ipAddress = req.headers['x-forwarded-for'] || req.ip || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        const headers = {
            accept: req.headers['accept'],
            origin: req.headers['origin'],
            referer: req.headers['referer']
        };
        await query(
            `INSERT INTO honeypot_triggers (ip_address, endpoint, user_agent, headers)
       VALUES ($1, $2, $3, $4)`,
            [ipAddress, endpoint, userAgent, JSON.stringify(headers)]
        );
        // Also create a fraud event
        await logFraudEvent(null, 'honeypot_triggered', 'high', {
            ip: ipAddress, endpoint, userAgent
        });
    } catch (err) {
        console.error('Honeypot log failed:', err.message);
    }
}

async function logLoginAnomaly(userId, anomalyType, details = {}) {
    try {
        await query(
            `INSERT INTO login_anomalies (user_id, anomaly_type, details)
       VALUES ($1, $2, $3)`,
            [userId, anomalyType, JSON.stringify(details)]
        );
    } catch (err) {
        console.error('Login anomaly log failed:', err.message);
    }
}

module.exports = { logAudit, logFraudEvent, logHoneypotTrigger, logLoginAnomaly };
