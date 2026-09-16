// Input validation and sanitization utilities

// Strict schema validation — reject unknown parameters
function validateSchema(schema) {
    return (req, res, next) => {
        const body = req.body;
        const errors = [];

        // Check for unknown parameters
        const allowedKeys = new Set(Object.keys(schema));
        // Always allow captcha fields and honeypot trap
        allowedKeys.add('captchaId');
        allowedKeys.add('captchaAnswer');
        allowedKeys.add('_hp_email'); // honeypot
        allowedKeys.add('_hp_phone'); // honeypot
        allowedKeys.add('deviceFingerprint');

        const unknownKeys = Object.keys(body).filter(k => !allowedKeys.has(k));
        if (unknownKeys.length > 0) {
            return res.status(400).json({
                error: 'Unknown parameters rejected',
                code: 'UNKNOWN_PARAMS',
                details: `Unknown: ${unknownKeys.join(', ')}`
            });
        }

        // Validate required fields and types
        for (const [field, rules] of Object.entries(schema)) {
            const value = body[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push(`${field} is required`);
                continue;
            }

            if (value === undefined || value === null) continue;

            // Type checking
            if (rules.type === 'string' && typeof value !== 'string') {
                errors.push(`${field} must be a string`);
            } else if (rules.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
                errors.push(`${field} must be a number`);
            } else if (rules.type === 'email' && typeof value === 'string') {
                if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) {
                    errors.push(`${field} must be a valid email`);
                }
            }

            // Length checks
            if (typeof value === 'string') {
                if (rules.minLength && value.length < rules.minLength) {
                    errors.push(`${field} must be at least ${rules.minLength} characters`);
                }
                if (rules.maxLength && value.length > rules.maxLength) {
                    errors.push(`${field} must be at most ${rules.maxLength} characters`);
                }
                if (rules.pattern && !rules.pattern.test(value)) {
                    errors.push(`${field} format is invalid`);
                }
            }

            // Number range
            if (typeof value === 'number') {
                if (rules.min !== undefined && value < rules.min) {
                    errors.push(`${field} must be at least ${rules.min}`);
                }
                if (rules.max !== undefined && value > rules.max) {
                    errors.push(`${field} must be at most ${rules.max}`);
                }
            }
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: 'Validation failed', details: errors });
        }

        next();
    };
}

// Sanitize string inputs to prevent XSS
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Sanitize all string fields in request body
function sanitizeBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        for (const [key, value] of Object.entries(req.body)) {
            if (typeof value === 'string') {
                // Don't sanitize password fields (they need special chars)
                if (!key.toLowerCase().includes('password')) {
                    req.body[key] = sanitizeInput(value);
                }
            }
        }
    }
    next();
}

// Prevent IDOR — verify resource ownership
function verifyOwnership(resourceUserIdField) {
    return (req, res, next) => {
        const resourceUserId = req.params[resourceUserIdField] || req.body[resourceUserIdField];
        if (resourceUserId && resourceUserId !== req.user?.userId) {
            return res.status(403).json({ error: 'Access denied — resource ownership violation', code: 'IDOR_BLOCKED' });
        }
        next();
    };
}

// Common schemas
const SCHEMAS = {
    signup: {
        username: { type: 'string', required: true, minLength: 3, maxLength: 30, pattern: /^[a-zA-Z0-9_]+$/ },
        email: { type: 'email', required: true, maxLength: 255 },
        password: { type: 'string', required: true, minLength: 8, maxLength: 128 },
        phone: { type: 'string', required: false, maxLength: 20, pattern: /^[0-9+\-\s()]*$/ },
        fullName: { type: 'string', required: false, maxLength: 100 }
    },
    login: {
        username: { type: 'string', required: true, maxLength: 50 },
        password: { type: 'string', required: true, maxLength: 128 }
    },
    verifyOtp: {
        userId: { type: 'string', required: true },
        otp: { type: 'string', required: true, minLength: 6, maxLength: 6 }
    },
    transfer: {
        toUsername: { type: 'string', required: true, maxLength: 50 },
        amount: { type: 'number', required: true, min: 0.01, max: 1000000 },
        transactionToken: { type: 'string', required: true },
        note: { type: 'string', required: false, maxLength: 200 }
    },
    addBeneficiary: {
        beneficiaryUsername: { type: 'string', required: true, maxLength: 50 },
        nickname: { type: 'string', required: false, maxLength: 100 }
    },
    signTransaction: {
        toUsername: { type: 'string', required: true, maxLength: 50 },
        amount: { type: 'number', required: true, min: 0.01, max: 1000000 }
    }
};

module.exports = { validateSchema, sanitizeInput, sanitizeBody, verifyOwnership, SCHEMAS };
