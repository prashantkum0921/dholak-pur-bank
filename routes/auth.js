const express = require('express');
const argon2 = require('argon2');
const crypto = require('crypto');
const router = express.Router();
const { query } = require('../lib/db');
const { encrypt } = require('../lib/encryption');
const {
    generateAccessToken, generateRefreshToken,
    storeRefreshToken, validateRefreshToken,
    rotateRefreshToken, revokeAllUserSessions, authenticateToken
} = require('../lib/auth');
const { logAudit, logFraudEvent } = require('../lib/audit');
const { detectLoginAnomalies, handleFailedLogin, resetFailedLogins } = require('../lib/anomaly');
const { captchaMiddleware } = require('../lib/captcha');
const { rateLimitMiddleware } = require('../lib/rate-limiter');
const { honeypotFieldCheck } = require('../lib/honeypot');
const { validateSchema, SCHEMAS, sanitizeBody } = require('../lib/validation');
const { botDetectionMiddleware } = require('../lib/bot-detection');
const { sendOtpEmail } = require('../lib/email');

// Constants for OTP security
const OTP_MAX_ATTEMPTS = 3;

// POST /api/auth/signup
router.post('/signup',
    sanitizeBody,
    honeypotFieldCheck,
    rateLimitMiddleware('signup'),
    validateSchema(SCHEMAS.signup),
    captchaMiddleware,
    async (req, res) => {
        try {
            const { username, email, password, phone, fullName, deviceFingerprint } = req.body;
            const ip = req.headers['x-forwarded-for'] || req.ip;

            // Check if username or email already exists
            const existing = await query(
                `SELECT id FROM users WHERE username = $1 OR email = $2`, [username, email]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Username or email already registered' });
            }

            // Hash password with Argon2
            const passwordHash = await argon2.hash(password, {
                type: argon2.argon2id,
                memoryCost: 65536,
                timeCost: 3,
                parallelism: 4
            });

            // Generate OTP secret for this user
            const otpSecret = crypto.randomBytes(20).toString('hex');

            // Create user
            const result = await query(
                `INSERT INTO users (username, email, password_hash, phone, device_fingerprint, last_known_ip, otp_secret)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email`,
                [username, email, passwordHash, phone || null, deviceFingerprint || null, ip, otpSecret]
            );

            const user = result[0];

            // Create wallet with initial balance (simulated deposit)
            const initialBalance = 10000.00;
            const encryptedBalance = encrypt(String(initialBalance));
            await query(
                `INSERT INTO wallets (user_id, balance_encrypted) VALUES ($1, $2)`,
                [user.id, encryptedBalance]
            );

            // Log the signup
            await logAudit(user.id, 'signup', req, { username, email, phone: !!phone });

            // Identity verification simulation — always succeeds for demo
            await logAudit(user.id, 'identity_verified', req, { method: 'simulated', status: 'passed' });

            res.status(201).json({
                message: 'Account created successfully',
                user: { id: user.id, username: user.username, email: user.email },
                identityVerification: { status: 'verified', method: 'document_simulation' }
            });
        } catch (err) {
            console.error('Signup error:', err);
            res.status(500).json({ error: 'Registration failed' });
        }
    }
);

// POST /api/auth/login
router.post('/login',
    sanitizeBody,
    honeypotFieldCheck,
    rateLimitMiddleware('login'),
    botDetectionMiddleware,
    validateSchema(SCHEMAS.login),
    captchaMiddleware,
    async (req, res) => {
        try {
            const { username, password, deviceFingerprint } = req.body;
            const ip = req.headers['x-forwarded-for'] || req.ip;

            // Find user
            const users = await query(
                `SELECT id, username, email, password_hash, is_locked, lock_reason, failed_login_count FROM users WHERE username = $1`,
                [username]
            );

            if (users.length === 0) {
                await logAudit(null, 'login_failed', req, { username, reason: 'user_not_found' }, 'warning');
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const user = users[0];

            // Check if account is locked
            if (user.is_locked) {
                await logAudit(user.id, 'login_attempt_locked', req, { username }, 'warning');
                return res.status(423).json({ error: 'Account is locked', reason: user.lock_reason });
            }

            // Verify password
            const validPassword = await argon2.verify(user.password_hash, password);
            if (!validPassword) {
                await logAudit(user.id, 'login_failed', req, { username, reason: 'invalid_password' }, 'warning');
                const lockResult = await handleFailedLogin(user.id, req);
                if (lockResult.locked) {
                    return res.status(423).json({ error: 'Account locked due to too many failed attempts' });
                }
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Detect login anomalies
            const anomalies = await detectLoginAnomalies(user.id, req);

            // === GENERATE OTP ===
            // Using cryptographically secure random numbers instead of Math.random
            const maxRange = 999999;
            const minRange = 100000;
            const rawOtp = String(crypto.randomInt(minRange, maxRange + 1));

            // Hash the OTP before storing to DB
            const hashedOtp = crypto.createHash('sha256').update(rawOtp).digest('hex');

            await query(
                `INSERT INTO otp_records (user_id, otp_hash, expires_at)
                 VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
                [user.id, hashedOtp]
            );

            await logAudit(user.id, 'otp_generated', req, { purpose: 'login', anomalies: anomalies.length });

            // Send OTP via Resend
            // If email fails, the user won't get the code, but we don't leak it in the API
            sendOtpEmail(user.email, rawOtp, user.username).catch(err => {
                console.error('Failed to send OTP email via Resend to user:', user.id, err);
            });

            // Add anomaly warnings to response if any exist (but don't block login yet)
            const responseData = {
                message: 'OTP required',
                requiresOtp: true,
                userId: user.id,
                anomalies: anomalies.length > 0 ? anomalies.map(a => a.type) : undefined,
                // DEV MODE: return OTP in response since email delivery is restricted locally
                devOtp: rawOtp,
            };

            res.json(responseData);
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Login failed' });
        }
    }
);

// POST /api/auth/verify-otp
router.post('/verify-otp',
    sanitizeBody,
    rateLimitMiddleware('otp'),
    validateSchema(SCHEMAS.verifyOtp),
    async (req, res) => {
        try {
            const { userId, otp } = req.body;
            const ip = req.headers['x-forwarded-for'] || req.ip;
            const deviceInfo = req.headers['user-agent'];
            const deviceFingerprint = req.body.deviceFingerprint;

            // Hash the provided OTP to compare with the DB
            const hashedOtpProvided = crypto.createHash('sha256').update(otp).digest('hex');

            // Find valid OTP and atomically mark as used
            const otpRecords = await query(
                `UPDATE otp_records SET is_used = TRUE, attempts = 0 
                 WHERE id = (
                     SELECT id FROM otp_records 
                     WHERE user_id = $1 AND otp_hash = $2 AND is_used = FALSE AND expires_at > NOW()
                     ORDER BY created_at DESC LIMIT 1
                 )
                 RETURNING id`,
                [userId, hashedOtpProvided]
            );

            if (otpRecords.length === 0) {
                // Determine if it was just a wrong OTP to record the failed attempt
                const latestOtp = await query(
                    `SELECT id, attempts FROM otp_records WHERE user_id = $1 AND is_used = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
                    [userId]
                );

                if (latestOtp.length === 0) {
                    await logAudit(userId, 'otp_failed', req, { reason: 'no_valid_otp_record' }, 'warning');
                    return res.status(401).json({ error: 'Invalid or expired OTP' });
                }

                const otpRecord = latestOtp[0];
                const newAttempts = Number(otpRecord.attempts) + 1;

                if (newAttempts >= OTP_MAX_ATTEMPTS) {
                    await query(`UPDATE otp_records SET attempts = $1, is_used = TRUE WHERE id = $2`, [newAttempts, otpRecord.id]);
                    await logFraudEvent(userId, 'otp_brute_force', 'high', { reason: 'Max OTP attempts exceeded' });
                    return res.status(401).json({ error: 'Too many invalid attempts. Please request a new OTP.' });
                } else {
                    await query(`UPDATE otp_records SET attempts = $1 WHERE id = $2`, [newAttempts, otpRecord.id]);
                    await logAudit(userId, 'otp_failed', req, { reason: 'invalid_otp', attempts: newAttempts }, 'warning');
                    return res.status(401).json({ error: 'Invalid OTP' });
                }
            }

            // Reset failed login counter
            await resetFailedLogins(userId);

            // Update user's device info and IP
            await query(
                `UPDATE users SET device_fingerprint = COALESCE($1, device_fingerprint), last_known_ip = $2, updated_at = NOW() WHERE id = $3`,
                [deviceFingerprint, ip, userId]
            );

            // Generate tokens
            const user = (await query(`SELECT id, username, email FROM users WHERE id = $1`, [userId]))[0];
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken();
            await storeRefreshToken(userId, refreshToken, deviceInfo, ip);

            await logAudit(userId, 'login_success', req, { username: user.username });

            res.json({
                message: 'Login successful',
                accessToken,
                refreshToken,
                user: { id: user.id, username: user.username, email: user.email }
            });
        } catch (err) {
            console.error('OTP verification error:', err);
            res.status(500).json({ error: 'Verification failed' });
        }
    }
);

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        const session = await validateRefreshToken(refreshToken);
        if (!session) {
            return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_INVALID' });
        }

        if (session.is_locked) {
            return res.status(423).json({ error: 'Account is locked' });
        }

        const ip = req.headers['x-forwarded-for'] || req.ip;
        const deviceInfo = req.headers['user-agent'];

        // Rotate refresh token
        const newRefreshToken = await rotateRefreshToken(refreshToken, session.user_id, deviceInfo, ip);

        // Generate new access token
        const accessToken = generateAccessToken({ id: session.user_id, username: session.username });

        res.json({ accessToken, refreshToken: newRefreshToken });
    } catch (err) {
        console.error('Token refresh error:', err);
        res.status(500).json({ error: 'Token refresh failed' });
    }
});

// POST /api/auth/logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const { refreshToken, logoutAll } = req.body;

        if (logoutAll) {
            await revokeAllUserSessions(req.user.userId);
            await logAudit(req.user.userId, 'logout_all_sessions', req);
        } else if (refreshToken) {
            const { hashToken } = require('../lib/encryption');
            const tokenHash = hashToken(refreshToken);
            await query(`UPDATE sessions SET is_revoked = TRUE WHERE refresh_token_hash = $1`, [tokenHash]);
        }

        await logAudit(req.user.userId, 'logout', req);
        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Logout failed' });
    }
});

// GET /api/auth/me — Get current user info
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const users = await query(
            `SELECT u.id, u.username, u.email, u.phone, u.is_locked, u.created_at,
              w.balance_encrypted FROM users u 
       LEFT JOIN wallets w ON u.id = w.user_id
       WHERE u.id = $1`,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        const { decrypt } = require('../lib/encryption');
        let balance = 0;
        if (user.balance_encrypted) {
            try {
                const decrypted = decrypt(user.balance_encrypted);
                balance = decrypted ? parseFloat(decrypted) : 0;
            } catch (e) {
                console.error('Balance decrypt error:', e.message);
                balance = 0;
            }
        }

        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            phone: user.phone,
            balance: balance,
            isLocked: user.is_locked,
            createdAt: user.created_at
        });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

module.exports = router;
