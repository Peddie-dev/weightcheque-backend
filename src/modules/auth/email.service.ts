import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL ?? 'onboarding@resend.dev';
const APP    = 'Weight Cheque';

export const emailService = {
  async sendOtp(to: string, otp: string, name?: string) {
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `${otp} is your ${APP} reset code`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:16px">
          <img src="https://weightcheque.com/icon.png" width="48" height="48" style="border-radius:12px;margin-bottom:16px" />
          <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1a">Reset your password</h2>
          <p style="color:#757575;margin:0 0 24px;line-height:1.6">
            Hi ${name ?? 'there'}, use the code below to reset your Weight Cheque password.
            This code expires in <strong>15 minutes</strong>.
          </p>
          <div style="background:#f7f7f7;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <span style="font-size:36px;font-weight:900;letter-spacing:8px;color:#fea928">${otp}</span>
          </div>
          <p style="color:#9e9e9e;font-size:13px;margin:0">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  },

  async sendWelcome(to: string, name: string) {
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `Welcome to ${APP}, ${name}!`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#fff;border-radius:16px">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1a">Welcome, ${name}!</h2>
          <p style="color:#757575;margin:0 0 16px;line-height:1.6">
            Your Weight Cheque account is ready. Complete your profile to get your personalised nutrition plan.
          </p>
          <p style="color:#9e9e9e;font-size:13px;margin:0">The Weight Cheque Team</p>
        </div>
      `,
    });
  },
};