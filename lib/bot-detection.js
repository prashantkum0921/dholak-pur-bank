const { logFraudEvent, logAudit } = require('./audit');

// Track request patterns per IP in memory (per serverless invocation)
// For distributed detection, these would be backed by DB/Redis
const requestPatterns = new Map();

function getIpPattern(ip) {
    if (!requestPatterns.has(ip)) {
        requestPatterns.set(ip, {
            requests: [],
            usernames: new Set(),
            endpoints: [],
            firstSeen: Date.now()
        });
    }
    return requestPatterns.get(ip);
}

async function detectBotBehavior(req) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const flags = [];

    // 1. Missing or suspicious user agent
    if (!userAgent || userAgent.length < 10) {
        flags.push('missing_user_agent');
    }

    // Common bot user agents
    const botPatterns = ['curl', 'wget', 'python', 'scrapy', 'httpie', 'postman'];
    if (botPatterns.some(p => userAgent.toLowerCase().includes(p))) {
        flags.push('bot_user_agent');
    }

    // 2. Missing standard headers
    if (!req.headers['accept'] && !req.headers['accept-language']) {
        flags.push('missing_browser_headers');
    }

    // 3. Check for credential stuffing pattern (same IP, multiple usernames)
    const pattern = getIpPattern(ip);
    if (req.body?.username) {
        pattern.usernames.add(req.body.username);
        if (pattern.usernames.size >= 3) {
            flags.push('credential_stuffing');
            await logFraudEvent(null, 'credential_stuffing_detected', 'high', {
                ip, usernameCount: pattern.usernames.size
            });
        }
    }

    // 4. Request timing analysis (too fast for human)
    pattern.requests.push(Date.now());
    // Keep only last 20 requests
    if (pattern.requests.length > 20) pattern.requests.shift();

    if (pattern.requests.length >= 5) {
        const intervals = [];
        for (let i = 1; i < pattern.requests.length; i++) {
            intervals.push(pattern.requests[i] - pattern.requests[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

        // If average interval is less than 500ms, likely scripted
        if (avgInterval < 500) {
            flags.push('scripted_requests');
        }

        // Check for suspiciously regular intervals (< 50ms variance)
        if (intervals.length >= 3) {
            const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
            if (variance < 2500 && avgInterval < 2000) {
                flags.push('mechanical_timing');
            }
        }
    }

    return {
        isBot: flags.length >= 2,
        isSuspicious: flags.length >= 1,
        flags
    };
}

// Middleware
function botDetectionMiddleware(req, res, next) {
    detectBotBehavior(req).then(result => {
        req.botDetection = result;
        if (result.isBot) {
            logAudit(null, 'bot_detected', req, { flags: result.flags }, 'warning');
            // Don't immediately block — just flag and potentially delay
            // The delayed response makes bot operation slower
            const delay = 1000 + Math.random() * 2000;
            setTimeout(() => next(), delay);
        } else {
            next();
        }
    }).catch(() => next());
}

// Cleanup old patterns periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of requestPatterns.entries()) {
        if (now - val.firstSeen > 600000) requestPatterns.delete(key); // 10 min
    }
}, 60000);

module.exports = { detectBotBehavior, botDetectionMiddleware };
