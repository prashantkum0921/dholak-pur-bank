const express = require('express');
const router = express.Router();
const { query, getTaggedSql } = require('../lib/db');
const { encrypt, decrypt, generateNonce, generateTxHash, hashToken } = require('../lib/encryption');
const { authenticateToken, checkAccountLock } = require('../lib/auth');
const { logAudit, logFraudEvent } = require('../lib/audit');
const { analyzeTransferRisk } = require('../lib/fraud-engine');
const { rateLimitMiddleware } = require('../lib/rate-limiter');
const { validateSchema, SCHEMAS, sanitizeBody } = require('../lib/validation');
const crypto = require('crypto');

// Import signature verifier from transactions route
const { verifyTokenSignature } = require('./transactions');

// GET /api/wallet/balance
router.get('/balance', authenticateToken, checkAccountLock, async (req, res) => {
    try {
        const wallets = await query(
            `SELECT balance_encrypted, nonce FROM wallets WHERE user_id = $1`,
            [req.user.userId]
        );

        if (wallets.length === 0) {
            return res.status(404).json({ error: 'Wallet not found' });
        }

        const balance = decrypt(wallets[0].balance_encrypted);
        res.json({
            balance: balance ? parseFloat(balance) : 0,
            currency: 'DPB',
            lastUpdated: new Date().toISOString()
        });
    } catch (err) {
        console.error('Balance error:', err);
        res.status(500).json({ error: 'Failed to retrieve balance' });
    }
});

// POST /api/wallet/transfer
// Uses Neon's non-interactive transaction API for true atomicity.
// Strategy: validate everything first, then execute all writes in one atomic batch.
router.post('/transfer',
    authenticateToken,
    checkAccountLock,
    sanitizeBody,
    rateLimitMiddleware('transfer'),
    validateSchema(SCHEMAS.transfer),
    async (req, res) => {
        try {
            const { toUsername, amount, transactionToken, note } = req.body;
            const fromUserId = req.user.userId;
            const ip = req.headers['x-forwarded-for'] || req.ip;

            // === STEP 1: INPUT VALIDATION ===

            const parsedAmount = parseFloat(amount);
            if (isNaN(parsedAmount) || parsedAmount <= 0) {
                return res.status(400).json({ error: 'Amount must be positive', code: 'NEGATIVE_BALANCE_BYPASS' });
            }
            if (parsedAmount !== Math.round(parsedAmount * 100) / 100) {
                return res.status(400).json({ error: 'Amount can have at most 2 decimal places' });
            }

            // === STEP 2: RESOLVE RECIPIENT ===

            const recipients = await query(`SELECT id FROM users WHERE username = $1`, [toUsername]);
            if (recipients.length === 0) {
                return res.status(404).json({ error: 'Recipient not found' });
            }
            const toUserId = recipients[0].id;

            if (fromUserId === toUserId) {
                return res.status(400).json({ error: 'Cannot transfer to yourself' });
            }

            // === STEP 3: VALIDATE TRANSACTION TOKEN ===

            const tokenHash = hashToken(transactionToken);
            const tokenRecords = await query(
                `SELECT id, amount, to_user_id, nonce, signed_at, signature, is_used, expires_at
                 FROM transaction_tokens
                 WHERE user_id = $1 AND token_hash = $2`,
                [fromUserId, tokenHash]
            );

            if (tokenRecords.length === 0) {
                await logAudit(fromUserId, 'invalid_transaction_token', req, { reason: 'not_found' }, 'warning');
                return res.status(400).json({ error: 'Invalid transaction token', code: 'INVALID_TX_TOKEN' });
            }

            const txToken = tokenRecords[0];

            if (txToken.is_used) {
                return res.status(409).json({ error: 'Transaction already processed', code: 'DOUBLE_SPEND' });
            }

            if (new Date(txToken.expires_at) <= new Date()) {
                return res.status(400).json({ error: 'Transaction token expired', code: 'TOKEN_EXPIRED' });
            }

            if (parseFloat(txToken.amount) !== parsedAmount) {
                await logAudit(fromUserId, 'amount_manipulation_attempt', req, {
                    signedAmount: txToken.amount, submittedAmount: parsedAmount
                }, 'critical');
                await logFraudEvent(fromUserId, 'amount_manipulation', 'critical', {
                    signedAmount: txToken.amount, submittedAmount: parsedAmount
                });
                return res.status(400).json({ error: 'Amount does not match signed transaction', code: 'AMOUNT_MANIPULATED' });
            }

            if (txToken.to_user_id !== toUserId) {
                await logAudit(fromUserId, 'beneficiary_tampering', req, {
                    signedRecipient: txToken.to_user_id, submittedRecipient: toUserId
                }, 'critical');
                await logFraudEvent(fromUserId, 'beneficiary_tampering', 'critical', {
                    signedRecipient: txToken.to_user_id, submittedRecipient: toUserId
                });
                return res.status(400).json({ error: 'Recipient does not match signed transaction', code: 'BENEFICIARY_TAMPERED' });
            }

            // Verify HMAC signature integrity
            try {
                const signedAt = txToken.signed_at instanceof Date ? txToken.signed_at.toISOString() : txToken.signed_at;
                const signatureValid = verifyTokenSignature(
                    fromUserId, toUserId, parsedAmount,
                    txToken.nonce, signedAt, txToken.signature
                );
                if (!signatureValid) {
                    await logFraudEvent(fromUserId, 'token_signature_invalid', 'critical', {
                        nonce: txToken.nonce, signed_at: txToken.signed_at
                    });
                    return res.status(400).json({ error: 'Token signature verification failed', code: 'SIGNATURE_INVALID' });
                }
            } catch (sigErr) {
                console.error('Signature verification error:', sigErr);
                return res.status(400).json({ error: 'Token signature verification failed', code: 'SIGNATURE_INVALID' });
            }

            // === STEP 4: FRAUD ANALYSIS ===

            const riskResult = await analyzeTransferRisk(fromUserId, toUserId, parsedAmount);

            if (riskResult.action === 'block') {
                await logAudit(fromUserId, 'transfer_blocked_fraud', req, riskResult, 'critical');
                return res.status(403).json({
                    error: 'Transaction blocked due to suspicious activity',
                    code: 'FRAUD_BLOCKED',
                    risks: riskResult.risks.map(r => r.type)
                });
            }

            if (riskResult.action === 'step_up') {
                await logAudit(fromUserId, 'transfer_step_up_required', req, riskResult, 'warning');
            }

            // === STEP 5: READ CURRENT BALANCES ===

            const senderWallets = await query(
                `SELECT id, balance_encrypted, nonce FROM wallets WHERE user_id = $1`,
                [fromUserId]
            );
            if (senderWallets.length === 0) {
                return res.status(400).json({ error: 'Sender wallet not found' });
            }

            const senderBalance = parseFloat(decrypt(senderWallets[0].balance_encrypted));

            if (senderBalance < parsedAmount) {
                await logAudit(fromUserId, 'insufficient_balance', req, {
                    balance: senderBalance, amount: parsedAmount
                }, 'warning');
                return res.status(400).json({ error: 'Insufficient balance', code: 'INSUFFICIENT_FUNDS' });
            }

            const recipientWallets = await query(
                `SELECT id, balance_encrypted, nonce FROM wallets WHERE user_id = $1`,
                [toUserId]
            );
            if (recipientWallets.length === 0) {
                return res.status(400).json({ error: 'Recipient wallet not found' });
            }

            const recipientBalance = parseFloat(decrypt(recipientWallets[0].balance_encrypted));

            // === STEP 6: CALCULATE NEW BALANCES ===

            const newSenderBalance = Math.round((senderBalance - parsedAmount) * 100) / 100;
            const newRecipientBalance = Math.round((recipientBalance + parsedAmount) * 100) / 100;

            if (newSenderBalance < 0) {
                return res.status(400).json({ error: 'Transaction would result in negative balance', code: 'NEGATIVE_BALANCE_BYPASS' });
            }

            // === STEP 7: PREPARE TRANSACTION DATA ===

            const txNonce = generateNonce();
            const timestamp = new Date().toISOString();
            const txHash = generateTxHash(fromUserId, toUserId, parsedAmount, txNonce, timestamp);

            // Replay check
            const existingTx = await query(`SELECT id FROM transactions WHERE tx_hash = $1`, [txHash]);
            if (existingTx.length > 0) {
                return res.status(409).json({ error: 'Duplicate transaction detected', code: 'REPLAY_ATTACK' });
            }

            const encryptedAmount = encrypt(String(parsedAmount));
            const encSenderBal = encrypt(String(newSenderBalance));
            const encRecipientBal = encrypt(String(newRecipientBalance));
            const txStatus = riskResult.action === 'step_up' ? 'flagged' : 'completed';
            const txMetadata = JSON.stringify({
                note: note || '',
                riskScore: riskResult.riskScore,
                risks: riskResult.risks,
                ip,
                tokenNonce: txToken.nonce,
                tokenSignedAt: txToken.signed_at
            });

            const senderNonce = senderWallets[0].nonce;
            const tokenId = txToken.id;

            // === STEP 8: ATOMIC EXECUTION (Stored Procedure) ===
            // This guarantees all 4 operations succeed or fail together at the DB layer
            let txId;
            try {
                const result = await query(
                    `SELECT execute_transfer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) as tx_id`,
                    [
                        fromUserId, toUserId, tokenId, parsedAmount, senderNonce,
                        encSenderBal, encRecipientBal, txHash, txNonce, txStatus,
                        txMetadata
                    ]
                );
                txId = result[0].tx_id;
            } catch (dbErr) {
                console.error('Atomic transfer failed:', dbErr.message);
                if (dbErr.message.includes('DUPLICATE_TX')) {
                    return res.status(409).json({ error: 'Duplicate transaction detected', code: 'REPLAY_ATTACK' });
                }
                if (dbErr.message.includes('TOKEN_USED')) {
                    return res.status(409).json({ error: 'Transaction already processed', code: 'DOUBLE_SPEND' });
                }
                if (dbErr.message.includes('CONCURRENT_UPDATE')) {
                    return res.status(409).json({ error: 'Transaction conflict, please retry', code: 'CONCURRENT_UPDATE' });
                }
                throw dbErr;
            }

            // === SUCCESS ===
            await logAudit(fromUserId, 'transfer_completed', req, {
                toUser: toUsername, amount: parsedAmount, txHash, riskScore: riskResult.riskScore
            });

            res.json({
                message: 'Transfer successful',
                transaction: {
                    id: txRecord[0].id,
                    amount: parsedAmount,
                    to: toUsername,
                    txHash,
                    status: txStatus,
                    timestamp: txRecord[0].created_at,
                    riskLevel: riskResult.riskScore > 0.5 ? 'high' : riskResult.riskScore > 0.3 ? 'medium' : 'low'
                },
                newBalance: newSenderBalance
            });
        } catch (err) {
            console.error('Transfer error:', err);
            res.status(500).json({ error: 'Transfer failed' });
        }
    }
);

module.exports = router;
