const svgCaptcha = require('svg-captcha');
const crypto = require('crypto');

// In-memory CAPTCHA store (short-lived, acceptable for serverless since CAPTCHAs expire quickly)
// For production at scale, store in Redis or DB
const captchaStore = new Map();

// Cleanup old CAPTCHAs periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of captchaStore.entries()) {
        if (now - val.created > 300000) captchaStore.delete(key); // 5 min expiry
    }
}, 60000);

function generateCaptcha() {
    const captcha = svgCaptcha.create({
        size: 5,
        noise: 3,
        color: true,
        background: '#1a1a2e',
        width: 180,
        height: 60,
        fontSize: 50,
        charPreset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    });

    const captchaId = crypto.randomBytes(16).toString('hex');
    captchaStore.set(captchaId, {
        text: captcha.text.toUpperCase(),
        created: Date.now()
    });

    return {
        id: captchaId,
        svg: captcha.data
    };
}

function validateCaptcha(captchaId, userAnswer) {
    if (!captchaId || !userAnswer) return false;

    const stored = captchaStore.get(captchaId);
    if (!stored) return false;

    // Expire after 5 minutes
    if (Date.now() - stored.created > 300000) {
        captchaStore.delete(captchaId);
        return false;
    }

    const isValid = stored.text === userAnswer.toUpperCase().trim();

    // One-time use: delete after validation attempt
    captchaStore.delete(captchaId);

    return isValid;
}

// Middleware factory
function captchaMiddleware(req, res, next) {
    const { captchaId, captchaAnswer } = req.body;

    if (!captchaId || !captchaAnswer) {
        return res.status(400).json({ error: 'CAPTCHA is required', code: 'CAPTCHA_REQUIRED' });
    }

    if (!validateCaptcha(captchaId, captchaAnswer)) {
        return res.status(400).json({ error: 'Invalid or expired CAPTCHA', code: 'CAPTCHA_INVALID' });
    }

    next();
}

module.exports = { generateCaptcha, validateCaptcha, captchaMiddleware };
