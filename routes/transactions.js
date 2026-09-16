const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../lib/db');
const { decrypt, hashToken, generateNonce } = require('../lib/encryption');
const { authenticateToken, checkAccountLock } = require('../lib/auth');
const { logAudit } = require('../lib/audit');
const { validateSchema, SCHEMAS, sanitizeBody } = require('../lib/validation');
const { captchaMiddleware } = require('../lib/captcha');

/**
 * Generate HMAC-SHA256 signature for transaction token integrity.
 * This binds amount + beneficiary + timestamp + nonce together cryptographically,
 * preventing any field from being tampered with after signing.
 */
function signTokenData(userId, toUserId, amount, nonce, timestamp) {
    const secret = process.env.JWT_SECRET; // reuse existing secret
    const payload = `${userId}:${toUserId}:${amount}:${nonce}:${timestamp}`;
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature to ensure token fields haven't been tampered with.
 */
function verifyTokenSignature(userId, toUserId, amount, nonce, timestamp, signature) {
    const expected = signTokenData(userId, toUserId, amount, nonce, timestamp);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

// GET /api/transactions — paginated transaction history
router.get('/', authenticateToken, checkAccountLock, async (req, res) => {
    try {
        const userId = req.user.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;

        const transactions = await query(
            `SELECT t.id, t.from_user_id, t.to_user_id, t.amount_plain, t.type, t.status, 
              t.tx_hash, t.created_at, t.metadata,
              fu.username as from_username, tu.username as to_username
       FROM transactions t
       LEFT JOIN users fu ON t.from_user_id = fu.id
       LEFT JOIN users tu ON t.to_user_id = tu.id
       WHERE t.from_user_id = $1 OR t.to_user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );

        const countResult = await query(
            `SELECT COUNT(*) as total FROM transactions WHERE from_user_id = $1 OR to_user_id = $1`,
            [userId]
        );

        res.json({
            transactions: transactions.map(tx => ({
                id: tx.id,
                type: tx.type,
                status: tx.status,
                amount: parseFloat(tx.amount_plain),
                direction: tx.from_user_id === userId ? 'sent' : 'received',
                counterparty: tx.from_user_id === userId ? tx.to_username : tx.from_username,
                txHash: tx.tx_hash,
                timestamp: tx.created_at,
                note: tx.metadata?.note || ''
            })),
            pagination: {
                page,
                limit,
                total: parseInt(countResult[0]?.total || 0),
                totalPages: Math.ceil(parseInt(countResult[0]?.total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('Get transactions error:', err);
        res.status(500).json({ error: 'Failed to retrieve transactions' });
    }
});

// POST /api/transactions/sign — Generate one-time signed transaction token
// Token includes: amount, beneficiary ID, timestamp, nonce
// Token is HMAC-signed to prevent any field tampering after signing
router.post('/sign',
    authenticateToken,
    checkAccountLock,
    sanitizeBody,
    validateSchema(SCHEMAS.signTransaction),
    captchaMiddleware,
    async (req, res) => {
        try {
            const { toUsername, amount } = req.body;
            const userId = req.user.userId;

            // Validate amount server-side
            const parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount) || parsedAmount <= 0) {
                return res.status(400).json({ error: 'Invalid amount' });
            }

            // Resolve recipient
            const recipients = await query(`SELECT id FROM users WHERE username = $1`, [toUsername]);
            if (recipients.length === 0) {
                return res.status(404).json({ error: 'Recipient not found' });
            }
            const toUserId = recipients[0].id;

            // Generate cryptographic nonce and timestamp
            const nonce = generateNonce();
            const timestamp = new Date().toISOString();

            // Generate one-time bearer token
            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = hashToken(token);

            // 2-minute expiry (tight window to prevent abuse)
            const expiresAt = new Date(Date.now() + 120000);

            // HMAC signature binding all four fields together
            const signature = signTokenData(userId, toUserId, parsedAmount, nonce, timestamp);

            await query(
                `INSERT INTO transaction_tokens (user_id, token_hash, amount, to_user_id, nonce, signed_at, signature, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [userId, tokenHash, parsedAmount, toUserId, nonce, timestamp, signature, expiresAt.toISOString()]
            );

            await logAudit(userId, 'transaction_signed', req, {
                toUsername, amount: parsedAmount, nonce, timestamp, expiresAt
            });

            res.json({
                transactionToken: token,
                amount: parsedAmount,
                toUsername,
                beneficiaryId: toUserId,
                nonce,
                timestamp,
                expiresAt: expiresAt.toISOString(),
                expiresIn: 120 // seconds
            });
        } catch (err) {
            console.error('Sign transaction error:', err);
            res.status(500).json({ error: 'Failed to sign transaction' });
        }
    }
);

// Export signature helpers for use in wallet.js
router.verifyTokenSignature = verifyTokenSignature;

module.exports = router;

