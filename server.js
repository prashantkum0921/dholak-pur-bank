const app = require('./app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════════╗
  ║     🏦 DHOLAK PUR BANK - Secure Banking     ║
  ║━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━║
  ║  Server running on port ${PORT}                ║
  ║  Local:  http://localhost:${PORT}              ║
  ║                                              ║
  ║  Security Features:                          ║
  ║  ✅ Helmet Security Headers                  ║
  ║  ✅ AES-256-GCM Encryption                   ║
  ║  ✅ Argon2 Password Hashing                  ║
  ║  ✅ JWT + Rotating Refresh Tokens            ║
  ║  ✅ Rate Limiting                            ║
  ║  ✅ CAPTCHA Protection                       ║
  ║  ✅ Fraud Detection Engine                   ║
  ║  ✅ Honeypot Active Defense                  ║
  ║  ✅ Immutable Audit Logging                  ║
  ╚══════════════════════════════════════════════╝
  `);
});
