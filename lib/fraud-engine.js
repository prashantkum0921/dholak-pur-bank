const { query } = require('./db');
const { logFraudEvent } = require('./audit');

const THRESHOLDS = {
    MAX_SINGLE_TRANSFER: 50000,        // Flag transfers above this
    RAPID_TRANSFER_COUNT: 5,           // Max transfers in window
    RAPID_TRANSFER_WINDOW: 600,        // 10 minutes in seconds
    UNUSUAL_HOUR_START: 2,             // 2 AM
    UNUSUAL_HOUR_END: 5,               // 5 AM
    NEW_BENEFICIARY_COOLDOWN: 3600,    // 1 hour after adding beneficiary before large transfers
    HIGH_RISK_SCORE_THRESHOLD: 0.75,
    AMOUNT_DEVIATION_MULTIPLIER: 3     // Flag if amount > 3x user's average
};

async function analyzeTransferRisk(userId, toUserId, amount) {
    const risks = [];
    let riskScore = 0;

    // 1. Check transfer amount against user's history
    const avgResult = await query(
        `SELECT AVG(amount_plain) as avg_amount, STDDEV(amount_plain) as stddev_amount, COUNT(*) as tx_count
     FROM transactions WHERE from_user_id = $1 AND status = 'completed'`,
        [userId]
    );

    const avg = parseFloat(avgResult[0]?.avg_amount || 0);
    const stddev = parseFloat(avgResult[0]?.stddev_amount || 0);
    const txCount = parseInt(avgResult[0]?.tx_count || 0);

    if (txCount > 5 && stddev > 0) {
        const zScore = (amount - avg) / stddev;
        if (zScore > THRESHOLDS.AMOUNT_DEVIATION_MULTIPLIER) {
            risks.push({ type: 'abnormal_amount', detail: `Amount ${amount} is ${zScore.toFixed(1)}σ above average` });
            riskScore += 0.3;
        }
    }

    // 2. Check if amount exceeds absolute threshold
    if (amount > THRESHOLDS.MAX_SINGLE_TRANSFER) {
        risks.push({ type: 'high_amount', detail: `Amount ${amount} exceeds threshold ${THRESHOLDS.MAX_SINGLE_TRANSFER}` });
        riskScore += 0.2;
    }

    // 3. Check rapid transfer bursts
    const recentTx = await query(
        `SELECT COUNT(*) as cnt FROM transactions 
     WHERE from_user_id = $1 AND created_at > NOW() - INTERVAL '${THRESHOLDS.RAPID_TRANSFER_WINDOW} seconds'`,
        [userId]
    );

    if (parseInt(recentTx[0]?.cnt || 0) >= THRESHOLDS.RAPID_TRANSFER_COUNT) {
        risks.push({ type: 'rapid_burst', detail: `${recentTx[0].cnt} transfers in last ${THRESHOLDS.RAPID_TRANSFER_WINDOW / 60} minutes` });
        riskScore += 0.3;
    }

    // 4. Check unusual time of day
    const currentHour = new Date().getHours();
    if (currentHour >= THRESHOLDS.UNUSUAL_HOUR_START && currentHour <= THRESHOLDS.UNUSUAL_HOUR_END) {
        risks.push({ type: 'unusual_time', detail: `Transfer at unusual hour: ${currentHour}:00` });
        riskScore += 0.1;
    }

    // 5. Check beneficiary risk score
    const beneficiary = await query(
        `SELECT risk_score, is_verified, created_at FROM beneficiaries 
     WHERE user_id = $1 AND beneficiary_user_id = $2`,
        [userId, toUserId]
    );

    if (beneficiary.length === 0) {
        risks.push({ type: 'unknown_beneficiary', detail: 'Transfer to non-registered beneficiary' });
        riskScore += 0.3;
    } else {
        const bRisk = parseFloat(beneficiary[0].risk_score);
        if (bRisk > THRESHOLDS.HIGH_RISK_SCORE_THRESHOLD) {
            risks.push({ type: 'high_risk_beneficiary', detail: `Beneficiary risk score: ${bRisk}` });
            riskScore += 0.2;
        }

        // Check if beneficiary was recently added and this is a large transfer
        const addedAt = new Date(beneficiary[0].created_at);
        const hoursSinceAdded = (Date.now() - addedAt.getTime()) / 3600000;
        if (hoursSinceAdded < 1 && amount > 1000) {
            risks.push({ type: 'new_beneficiary_large_transfer', detail: `Large transfer to beneficiary added ${hoursSinceAdded.toFixed(1)}h ago` });
            riskScore += 0.2;
        }
    }

    // Cap risk score at 1.0
    riskScore = Math.min(riskScore, 1.0);

    // Determine action
    let action = 'allow';
    if (riskScore >= 0.8) {
        action = 'block';
        await logFraudEvent(userId, 'high_risk_transfer_blocked', 'critical', { amount, toUserId, risks, riskScore });
    } else if (riskScore >= 0.5) {
        action = 'step_up';
        await logFraudEvent(userId, 'high_risk_transfer_flagged', 'high', { amount, toUserId, risks, riskScore });
    } else if (riskScore >= 0.3) {
        action = 'captcha';
        await logFraudEvent(userId, 'moderate_risk_transfer', 'medium', { amount, toUserId, risks, riskScore });
    }

    return { riskScore, risks, action };
}

async function calculateBeneficiaryRiskScore(userId, beneficiaryUserId) {
    let score = 0.5; // Base score

    // Check if beneficiary has any transaction history with the user
    const txHistory = await query(
        `SELECT COUNT(*) as cnt FROM transactions 
     WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
        [userId, beneficiaryUserId]
    );
    if (parseInt(txHistory[0]?.cnt || 0) === 0) {
        score += 0.2; // No prior history = higher risk
    }

    // Check beneficiary account age
    const beneficiaryUser = await query(
        `SELECT created_at FROM users WHERE id = $1`,
        [beneficiaryUserId]
    );
    if (beneficiaryUser.length > 0) {
        const ageInDays = (Date.now() - new Date(beneficiaryUser[0].created_at).getTime()) / 86400000;
        if (ageInDays < 7) {
            score += 0.2; // New account = higher risk
        }
    }

    return Math.min(score, 1.0);
}

module.exports = { analyzeTransferRisk, calculateBeneficiaryRiskScore, THRESHOLDS };
