require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// === SECURITY HEADERS (Browser & Header Security) ===
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"]
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true
}));

// CORS
app.use(cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
}));

// Body parsing with size limits (prevent large payload attacks)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());

// Request ID for tracing
app.use((req, res, next) => {
    req.requestId = require('crypto').randomBytes(8).toString('hex');
    res.set('X-Request-ID', req.requestId);
    next();
});

// Landing page as root
app.get(['/', '/landing'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// App portal (direct access to banking SPA)
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static files without auto-serving index.html for root
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// === CAPTCHA ROUTE (must be before auth) ===
const { generateCaptcha } = require('./lib/captcha');
app.get('/api/captcha', (req, res) => {
    const captcha = generateCaptcha();
    res.json(captcha);
});

// === HONEYPOT / DECEPTION ROUTES ===
const { createHoneypotRoutes } = require('./lib/honeypot');
createHoneypotRoutes(app);

// === API ROUTES ===
app.use('/api/auth', require('./routes/auth'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/beneficiaries', require('./routes/beneficiaries'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/admin', require('./routes/admin'));

// 404 handler
app.use((req, res) => {
    // Check if this looks like API probing
    if (req.path.startsWith('/api/')) {
        const { logAudit } = require('./lib/audit');
        logAudit(null, 'unknown_api_endpoint', req, { path: req.path, method: req.method }, 'warning').catch(() => { });
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    // For non-API routes, serve index.html (SPA)
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === GLOBAL ERROR HANDLER (never leak stack traces) ===
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    const { logAudit } = require('./lib/audit');
    logAudit(req.user?.userId || null, 'unhandled_error', req, {
        error: err.message,
        path: req.path
    }, 'critical').catch(() => { });

    // Randomized error response to prevent fingerprinting
    const messages = [
        'An error occurred',
        'Request could not be processed',
        'Please try again later',
        'Something went wrong'
    ];
    res.status(500).json({ error: messages[Math.floor(Math.random() * messages.length)] });
});

module.exports = app;
