const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { sendMail, mailMode } = require("../services/mailer");

const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "BREVO_API_KEY", "EMAIL_USER", "EMAIL_PASS", "EMAIL_FROM"];
const reset = (v = {}) => { KEYS.forEach((k) => delete process.env[k]); Object.assign(process.env, v); };

test("konfiqurasiya yoxdursa aydın xəta", async () => {
  reset();
  assert.equal(mailMode(), null);
  await assert.rejects(sendMail({ to: "a@b.co" }), /konfiqurasiya/);
});

test("üstünlük sırası", () => {
  reset({ EMAIL_USER: "a@b.co", EMAIL_PASS: "x" });
  assert.equal(mailMode(), "smtp");
  reset({ EMAIL_FROM: "a@b.co", BREVO_API_KEY: "x" });
  assert.equal(mailMode(), "brevo");
  reset({ EMAIL_FROM: "a@b.co", BREVO_API_KEY: "x", SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p" });
  assert.equal(mailMode(), "nodemailer");
});

test("TLS təklif etməyən serverə şifrə və məktub göndərilmir; ehtiyat yol işə düşür", async () => {
  let seen = "";
  const srv = net.createServer((s) => {
    s.write("220 x\r\n");
    s.on("error", () => {});
    s.on("data", (d) => { seen += d; s.write(/^EHLO/i.test(d) ? "250 x\r\n" : "454 no tls\r\n"); });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  reset({ EMAIL_FROM: "a@b.co", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(srv.address().port), SMTP_USER: "u", SMTP_PASS: "gizli" });
  await assert.rejects(sendMail({ to: "c@d.co", subject: "s", text: "t" }));
  assert.ok(!/AUTH|MAIL FROM/i.test(seen), seen);

  process.env.BREVO_API_KEY = "k";
  const real = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true }; };
  await sendMail({ to: "c@d.co", subject: "s", text: "t" });
  globalThis.fetch = real;
  srv.close();
  assert.equal(called, 1);
});
