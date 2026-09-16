const express = require('express');
const router = express.Router();
const { query } = require('../lib/db');
const { authenticateToken, checkAccountLock } = require('../lib/auth');
const { logAudit } = require('../lib/audit');
const { calculateBeneficiaryRiskScore } = require('../lib/fraud-engine');
const { captchaMiddleware } = require('../lib/captcha');
const { rateLimitMiddleware } = require('../lib/rate-limiter');
const { validateSchema, SCHEMAS, sanitizeBody } = require('../lib/validation');
const { honeypotFieldCheck } = require('../lib/honeypot');

// GET /api/beneficiaries
router.get('/', authenticateToken, checkAccountLock, async (req, res) => {
    try {
        const beneficiaries = await query(
            `SELECT b.id, b.nickname, b.risk_score, b.is_verified, b.created_at,
              u.username, u.email
       FROM beneficiaries b
       JOIN users u ON b.beneficiary_user_id = u.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
            [req.user.userId]
        );

        res.json({ beneficiaries });
    } catch (err) {
        console.error('Get beneficiaries error:', err);
        res.status(500).json({ error: 'Failed to retrieve beneficiaries' });
    }
});

// POST /api/beneficiaries
router.post('/',
    authenticateToken,
    checkAccountLock,
    sanitizeBody,
    honeypotFieldCheck,
    rateLimitMiddleware('beneficiary'),
    validateSchema(SCHEMAS.addBeneficiary),
    captchaMiddleware,
    async (req, res) => {
        try {
            const { beneficiaryUsername, nickname } = req.body;
            const userId = req.user.userId;

            // Find beneficiary user
            const users = await query(`SELECT id, username FROM users WHERE username = $1`, [beneficiaryUsername]);
            if (users.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const beneficiaryUserId = users[0].id;

            // Can't add yourself
            if (beneficiaryUserId === userId) {
                return res.status(400).json({ error: 'Cannot add yourself as a beneficiary' });
            }

            // Check if already exists
            const existing = await query(
                `SELECT id FROM beneficiaries WHERE user_id = $1 AND beneficiary_user_id = $2`,
                [userId, beneficiaryUserId]
            );
            if (existing.length > 0) {
                return res.status(409).json({ error: 'Beneficiary already exists' });
            }

            // Calculate risk score
            const riskScore = await calculateBeneficiaryRiskScore(userId, beneficiaryUserId);

            const result = await query(
                `INSERT INTO beneficiaries (user_id, beneficiary_user_id, nickname, risk_score)
         VALUES ($1, $2, $3, $4) RETURNING id, risk_score, created_at`,
                [userId, beneficiaryUserId, nickname || users[0].username, riskScore]
            );

            await logAudit(userId, 'beneficiary_added', req, {
                beneficiary: beneficiaryUsername, riskScore
            });

            res.status(201).json({
                message: 'Beneficiary added',
                beneficiary: {
                    id: result[0].id,
                    username: beneficiaryUsername,
                    nickname: nickname || users[0].username,
                    riskScore: result[0].risk_score,
                    isVerified: false,
                    createdAt: result[0].created_at
                }
            });
        } catch (err) {
            console.error('Add beneficiary error:', err);
            res.status(500).json({ error: 'Failed to add beneficiary' });
        }
    }
);

// DELETE /api/beneficiaries/:id
router.delete('/:id', authenticateToken, checkAccountLock, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;

        // Verify ownership (IDOR protection)
        const beneficiary = await query(
            `SELECT id, beneficiary_user_id FROM beneficiaries WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );

        if (beneficiary.length === 0) {
            return res.status(404).json({ error: 'Beneficiary not found' });
        }

        await query(`DELETE FROM beneficiaries WHERE id = $1 AND user_id = $2`, [id, userId]);
        await logAudit(userId, 'beneficiary_removed', req, { beneficiaryId: id });

        res.json({ message: 'Beneficiary removed' });
    } catch (err) {
        console.error('Delete beneficiary error:', err);
        res.status(500).json({ error: 'Failed to remove beneficiary' });
    }
});

module.exports = router;
