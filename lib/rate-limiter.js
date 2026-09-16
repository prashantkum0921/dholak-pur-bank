const { query } = require('./db');
const { logFraudEvent } = require('./audit');

// Rate limit configurations per endpoint category
const LIMITS = {
    login: { maxHits: 50, windowSeconds: 900, cooldownSeconds: 300 },
    signup: { maxHits: 20, windowSeconds: 3600, cooldownSeconds: 300 },
    otp: { maxHits: 20, windowSeconds: 300, cooldownSeconds: 120 },
    transfer: { maxHits: 50, windowSeconds: 3600, cooldownSeconds: 300 },
    beneficiary: { maxHits: 30, windowSeconds: 3600, cooldownSeconds: 300 },
    general: { maxHits: 200, windowSeconds: 60, cooldownSeconds: 60 }
};

async function checkRateLimit(ip, userId, endpoint) {
    const category = getCategoryForEndpoint(endpoint);
    const config = LIMITS[category] || LIMITS.general;
    const windowStart = new Date(Date.now() - config.windowSeconds * 1000);

    // Clean old entries probabilistically (5% chance) to avoid DoS via full table scan
    if (Math.random() < 0.05) {
        await query(
            `DELETE FROM rate_limit_events WHERE window_start < $1`,
            [new Date(Date.now() - 86400000).toISOString()]
        ).catch(err => console.error('Rate limit cleanup error:', err));
    }

    // Count hits in window
    const rows = await query(
        `SELECT COUNT(*) as cnt FROM rate_limit_events 
     WHERE ip_address = $1 AND endpoint = $2 AND window_start > $3`,
        [ip, category, windowStart.toISOString()]
    );

    const count = parseInt(rows[0]?.cnt || 0);

    // Record this hit
    await query(
        `INSERT INTO rate_limit_events (ip_address, user_id, endpoint, window_start)
     VALUES ($1, $2, $3, NOW())`,
        [ip, userId, category]
    );

    if (count >= config.maxHits) {
        await logFraudEvent(userId, 'rate_limit_exceeded', 'medium', {
            ip, endpoint: category, count: count + 1, limit: config.maxHits
        });
        return {
            limited: true,
            retryAfter: config.cooldownSeconds,
            message: `Too many requests. Try again in ${Math.ceil(config.cooldownSeconds / 60)} minutes.`
        };
    }

    return { limited: false, remaining: config.maxHits - count - 1 };
}

function getCategoryForEndpoint(endpoint) {
    if (endpoint.includes('login')) return 'login';
    if (endpoint.includes('signup') || endpoint.includes('register')) return 'signup';
    if (endpoint.includes('otp') || endpoint.includes('verify')) return 'otp';
    if (endpoint.includes('transfer')) return 'transfer';
    if (endpoint.includes('beneficiar')) return 'beneficiary';
    return 'general';
}

// Express middleware factory
function rateLimitMiddleware(category) {
    return async (req, res, next) => {
        try {
            const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
            const userId = req.user?.userId || null;
            const result = await checkRateLimit(ip, userId, category || req.path);
            if (result.limited) {
                res.set('Retry-After', String(result.retryAfter));
                return res.status(429).json({ error: result.message, retryAfter: result.retryAfter });
            }
            res.set('X-RateLimit-Remaining', String(result.remaining));
        } catch (err) {
            // DB unavailable — fail open (allow request through) rather than crashing
            console.error('Rate limiter DB error (failing open):', err.message);
        }
        next();
    };
}

module.exports = { checkRateLimit, rateLimitMiddleware, LIMITS };
