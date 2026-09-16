const { logHoneypotTrigger, logAudit } = require('./audit');

// Honeypot hidden form field detection
function honeypotFieldCheck(req, res, next) {
    // If hidden honeypot fields are filled, it's a bot
    const hpEmail = req.body._hp_email;
    const hpPhone = req.body._hp_phone;

    if (hpEmail || hpPhone) {
        // Silently flag — don't reveal that we detected the bot
        logHoneypotTrigger(req, `honeypot_form_field:${req.path}`);
        logAudit(null, 'honeypot_form_field', req, {
            path: req.path, hpEmail: !!hpEmail, hpPhone: !!hpPhone
        }, 'alert');

        // Return a plausible-looking delayed response
        const delay = 2000 + Math.random() * 3000;
        setTimeout(() => {
            res.status(200).json({ success: true, message: 'Request processed' });
        }, delay);
        return;
    }
    next();
}

// Decoy/honeypot endpoint handlers
function createHoneypotRoutes(router) {
    // Fake admin config endpoint
    router.get('/api/admin/config', async (req, res) => {
        await logHoneypotTrigger(req, '/api/admin/config');
        // Return fake data with delay
        setTimeout(() => {
            res.json({
                database: { host: 'internal-db.dholakpur.local', port: 5432 },
                cache: { host: 'redis.dholakpur.local' },
                version: '2.4.1',
                debug: false
            });
        }, 1500 + Math.random() * 2000);
    });

    // Fake debug endpoint
    router.get('/api/internal/debug', async (req, res) => {
        await logHoneypotTrigger(req, '/api/internal/debug');
        setTimeout(() => {
            res.json({
                status: 'ok',
                uptime: Math.floor(Math.random() * 86400),
                memory: { used: '245MB', total: '512MB' },
                connections: Math.floor(Math.random() * 100)
            });
        }, 2000 + Math.random() * 2000);
    });

    // Fake API v2
    router.get('/api/v2/users', async (req, res) => {
        await logHoneypotTrigger(req, '/api/v2/users');
        setTimeout(() => {
            res.json({
                users: [
                    { id: 1, name: 'Test User', email: 'test@example.com' },
                    { id: 2, name: 'Admin User', email: 'admin@example.com' }
                ],
                total: 2
            });
        }, 1000 + Math.random() * 2000);
    });

    // Fake environment endpoint
    router.get('/api/.env', async (req, res) => {
        await logHoneypotTrigger(req, '/api/.env');
        setTimeout(() => {
            res.status(403).json({ error: 'Forbidden' });
        }, 3000);
    });

    // Fake GraphQL endpoint
    router.post('/api/graphql', async (req, res) => {
        await logHoneypotTrigger(req, '/api/graphql');
        setTimeout(() => {
            res.json({ data: null, errors: [{ message: 'Authentication required' }] });
        }, 1500);
    });

    // Fake backup endpoint
    router.get('/api/admin/backup', async (req, res) => {
        await logHoneypotTrigger(req, '/api/admin/backup');
        setTimeout(() => {
            res.json({ status: 'backup in progress', eta: '5 minutes' });
        }, 2000);
    });

    return router;
}

// Randomize error messages to prevent fingerprinting
function randomizeError(baseMessage) {
    const variations = [
        baseMessage,
        'Request could not be processed',
        'An error occurred',
        'Please try again',
        'Operation failed'
    ];
    return variations[Math.floor(Math.random() * variations.length)];
}

// Delayed response for suspected automation
function delayedResponse(minMs = 1000, maxMs = 3000) {
    return (req, res, next) => {
        if (req.botDetection?.isSuspicious) {
            setTimeout(next, minMs + Math.random() * (maxMs - minMs));
        } else {
            next();
        }
    };
}

module.exports = { honeypotFieldCheck, createHoneypotRoutes, randomizeError, delayedResponse };
