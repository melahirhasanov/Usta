const express = require("express");
const bcrypt = require("bcryptjs");
const Users = require("../models/User");
const Master = require("../models/Master");
const { findByEmail } = require("../services/login");
const { checkPassword } = require("../middleware/validate");

const router = express.Router();
const { sendMail, mailMode } = require("../services/mailer");
const { createResetLink, hashToken } = require("../services/resetLink");

// Hesabın mövcudluğunu açıqlamamaq üçün cavab həmişə eynidir
const GENERIC = { success: true, message: "Bu email ilə hesab varsa, bərpa linki göndərildi. Poçt qutunuzu yoxlayın." };

async function findAccountByEmail(email) {
  const user = await findByEmail(Users, email);
  if (user) return { account: user, Model: Users };
  const master = await findByEmail(Master, email);
  if (master) return { account: master, Model: Master };
  return null;
}

router.post("/forgot-password", async (req, res) => {
  try {
    const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
    if (!email) return res.status(400).json({ message: "Email tələb olunur" });
    if (!mailMode()) return res.status(503).json({ message: "Email göndərmə hazırda işləmir. Dəstəyə yazın." });

    const found = await findAccountByEmail(email);
    if (found && !found.account.isDemo) {
      // Cavab gözlədilmir: hesabın olub-olmadığı nə mətndən, nə də cavab vaxtından bilinsin
      createResetLink(found.Model, found.account._id)
        .then((link) => sendMail({
          to: found.account.email,
          subject: "Əlüstü: şifrəni yeniləmə linki",
          text: `Şifrənizi yeniləmək üçün bu linkə keçin (1 saat etibarlıdır): ${link}\n\nBu sorğunu siz göndərməmisinizsə, bu emaili nəzərə almayın.`,
          html: `<div style="font-family:Arial,sans-serif;max-width:480px"><h2 style="color:#0F766E">Əlüstü</h2><p>Şifrənizi yeniləmək üçün düyməyə basın. Link 1 saat etibarlıdır.</p><p><a href="${link}" style="background:#0F766E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Şifrəni yenilə</a></p><p style="color:#64748B;font-size:13px">Bu sorğunu siz göndərməmisinizsə, bu emaili nəzərə almayın.</p></div>`,
        }))
        .catch((e) => console.error("Şifrə bərpa emaili göndərilmədi:", e.message));
    }
    res.json(GENERIC);
  } catch (err) {
    console.error("Şifrə bərpa xətası:", err.message);
    res.status(500).json({ message: "Xəta baş verdi, bir az sonra yenidən cəhd edin" });
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
