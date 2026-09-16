const { Resend } = require('resend');

// Initialize Resend
let resend;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
}

/**
 * Sends an email using the Resend API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML body
 * @returns {Promise<boolean>} Success status
 */
async function sendEmail(to, subject, html) {
    if (!resend) {
        console.warn('RESEND_API_KEY is not defined. Email will not be sent.');
        return false;
    }

    try {
        const data = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'Dholak Pur Bank <noreply@dholakpurbank.com>',
            to: to,
            subject: subject,
            html: html
        });

        return !!data.id;
    } catch (error) {
        console.error('Resend email error:', error);
        return false;
    }
}

/**
 * Sends an OTP email for login/verification
 * @param {string} to - Recipient email address
 * @param {string} otp - The 6-digit OTP code 
 * @param {string} username - User's name
 */
async function sendOtpEmail(to, otp, username) {
    console.log(`\n==============================================`);
    console.log(`✉️ EMAIL INTERCEPTED (DEV MODE)`);
    console.log(`To: ${to}`);
    console.log(`OTP CODE: ${otp}`);
    console.log(`==============================================\n`);

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #4f46e5; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">🏦 Dholak Pur Bank</h2>
            </div>
            <div style="padding: 30px; color: #334155;">
                <p>Hello <strong>${username}</strong>,</p>
                <p>Your one-time password (OTP) for secure verification is:</p>
                <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 15px; text-align: center; margin: 25px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e293b;">${otp}</span>
                </div>
                <p style="color: #ef4444; font-size: 14px; font-weight: bold;">⚠️ This code will expire in 5 minutes. Do not share it with anyone.</p>
                <p style="font-size: 14px; margin-top: 30px;">If you didn't request this code, please secure your account immediately or contact support.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b;">
                &copy; ${new Date().getFullYear()} Dholak Pur Bank. All rights reserved.
            </div>
        </div>
    `;

    return sendEmail(to, 'Your Security Code - Dholak Pur Bank', html);
}

module.exports = {
    sendEmail,
    sendOtpEmail
};
