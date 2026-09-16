const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
    const key = process.env.AES_KEY;
    if (!key || key.length !== 64) {
        throw new Error('AES_KEY must be a 64-character hex string (256-bit key)');
    }
    return Buffer.from(key, 'hex');
}

function encrypt(plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    const text = String(plaintext);
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) throw new Error('Invalid encrypted format');
        const iv = Buffer.from(parts[0], 'hex');
        const tag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const key = getKey();
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        console.error('Decryption failed:', err.message);
        return null;
    }
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

function generateTxHash(fromId, toId, amount, nonce, timestamp) {
    const data = `${fromId}:${toId}:${amount}:${nonce}:${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { encrypt, decrypt, hashToken, generateNonce, generateTxHash };
