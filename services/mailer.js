const nodemailer = require("nodemailer");

/**
 * Email göndərmə. BREVO_API_KEY varsa HTTPS API (Render-in pulsuz planı SMTP portlarını bağlayır), yoxdursa Gmail SMTP.
 * Göndərən: EMAIL_FROM (Brevo-da təsdiqlənmiş olmalıdır) və ya EMAIL_USER.
 */
const from = () => process.env.EMAIL_FROM || process.env.EMAIL_USER;

function mailMode() {
  if (process.env.BREVO_API_KEY && from()) return "brevo";
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) return "smtp";
  return null;
}

async function sendMail({ to, subject, text, html }) {
  const mode = mailMode();
  if (mode === "brevo") {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Əlüstü", email: from() }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (mode === "smtp") {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS.replace(/\s/g, "") },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    await transporter.sendMail({ to, from: `"Əlüstü" <${from()}>`, subject, text, html });
    return;
  }
  throw new Error("Email konfiqurasiya edilməyib");
}

module.exports = { sendMail, mailMode };
