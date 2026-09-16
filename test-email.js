require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function testEmail() {
    console.log('Testing Resend API...');
    console.log('API Key (first 10 chars):', process.env.RESEND_API_KEY?.substring(0, 10));
    console.log('FROM:', process.env.EMAIL_FROM);

    try {
        const result = await resend.emails.send({
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            to: 'kumyadav135@gmail.com',
            subject: 'Test OTP - Dholak Pur Bank',
            html: `<h2>Test Email</h2><p>Your Test OTP: <strong>123456</strong></p><p>If you received this, email delivery is working!</p>`
        });
        console.log('✅ Email send result:', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error('❌ Email failed:', err.message);
        console.error('Full error:', JSON.stringify(err, null, 2));
    }
}

testEmail();
