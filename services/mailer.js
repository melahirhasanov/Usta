const nodemailer = require("nodemailer");

/**
 * Email göndərmə (üstünlük sırası ilə):
 *  1) SMTP_HOST  — Nodemailer, port 2525 (Render-in pulsuz planı 25/465/587-ni bağlayır, 2525-i yox)
 *  2) BREVO_API_KEY — Brevo HTTPS API
 *  3) EMAIL_USER/EMAIL_PASS — Gmail SMTP (yalnız SMTP portları açıq olan serverdə)
 * 1 və 2 birlikdə qurulubsa, biri alınmayanda o biri yoxlanılır.
 */
const env = process.env;
const from = () => env.EMAIL_FROM || env.EMAIL_USER;

const viaSmtp = (options) => async (mail) => {
  const transporter = nodemailer.createTransport({ ...options, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  try {
    await transporter.sendMail({ ...mail, from: { name: "Əlüstü", address: from() } });
  } finally {
    transporter.close();
  }
};

async function viaBrevo({ to, subject, text, html }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Əlüstü", email: from() }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function transports() {
  const list = [];
  if (!from()) return list;
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    const port = Number(env.SMTP_PORT) || 2525;
    // requireTLS: şifrələnməmiş bağlantı ilə heç vaxt göndərilmir
    list.push(["nodemailer", viaSmtp({ host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } })]);
  }
  if (env.BREVO_API_KEY) list.push(["brevo", viaBrevo]);
  if (!list.length && env.EMAIL_USER && env.EMAIL_PASS) list.push(["smtp", viaSmtp({ service: "gmail", auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS.replace(/\s/g, "") } })]);
  return list;
}

const mailMode = () => transports()[0]?.[0] || null;

async function sendMail(mail) {
  const list = transports();
  if (!list.length) throw new Error("Email konfiqurasiya edilməyib");
  let last;
  for (const [name, send] of list) {
    try {
      return await send(mail);
    } catch (e) {
      last = e;
      console.error(`Email (${name}) alınmadı:`, e.message);
    }
  }
  throw last;
}

module.exports = { sendMail, mailMode };
