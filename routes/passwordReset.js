const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const Users = require("../models/User");
const Master = require("../models/Master");
const { checkPassword } = require("../middleware/validate");

const router = express.Router();
const { FRONTEND_URL } = require("../config/constants");
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 saat

// Bazada tokenin özü yox, SHA-256 hash-ı saxlanılır: baza sızsa belə linklər istifadə oluna bilməz
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Hesabın mövcudluğunu açıqlamamaq üçün cavab həmişə eynidir
const GENERIC = { success: true, message: "Bu email ilə hesab varsa, bərpa linki göndərildi. Poçt qutunuzu yoxlayın." };

async function findAccountByEmail(email) {
  const user = await Users.findOne({ email });
  if (user) return { account: user, Model: Users };
  const master = await Master.findOne({ email });
  if (master) return { account: master, Model: Master };
  return null;
}

router.post("/forgot-password", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    if (!email) return res.status(400).json({ message: "Email tələb olunur" });

    const found = await findAccountByEmail(email);
    if (!found) return res.json(GENERIC);

    const resetToken = crypto.randomBytes(32).toString("hex");
    await found.Model.updateOne(
      { _id: found.account._id },
      { resetPasswordToken: hashToken(resetToken), resetPasswordExpires: Date.now() + TOKEN_TTL_MS }
    );

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      to: found.account.email,
      from: `"Əlüstü" <${process.env.EMAIL_USER}>`,
      subject: "Şifrəni yeniləmə linki",
      text: `Şifrənizi yeniləmək üçün bu linkə keçin (1 saat etibarlıdır): ${FRONTEND_URL}/new-password/${resetToken}\n\nBu sorğunu siz göndərməmisinizsə, bu emaili nəzərə almayın.`,
    });
    res.json(GENERIC);
  } catch (err) {
    console.error("Şifrə bərpa xətası:", err.message);
    res.status(500).json({ message: "Email göndərmək mümkün olmadı, bir az sonra yenidən cəhd edin" });
  }
});

router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;
    const invalid = checkPassword(newPassword);
    if (invalid) return res.status(400).json({ message: invalid });
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: "Link etibarsızdır və ya vaxtı keçib" });

    const filter = { resetPasswordToken: hashToken(token), resetPasswordExpires: { $gt: Date.now() } };
    const reset = { $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } };

    const user = await Users.findOne(filter);
    if (user) {
      // Users modelinin pre-save hook-u şifrəni hash edir
      user.password = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      user.passwordChangedAt = new Date();
      await user.save({ validateBeforeSave: false });
      return res.json({ message: "Şifrə uğurla yeniləndi" });
    }

    const master = await Master.findOne(filter);
    if (master) {
      await Master.updateOne({ _id: master._id }, { password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date(), ...reset });
      return res.json({ message: "Şifrə uğurla yeniləndi" });
    }

    return res.status(400).json({ message: "Link etibarsızdır və ya vaxtı keçib" });
  } catch (err) {
    console.error("Şifrə yeniləmə xətası:", err.message);
    res.status(500).json({ message: "Server xətası" });
  }
});

module.exports = router;
