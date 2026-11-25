const crypto = require("crypto");
const { FRONTEND_URL } = require("../config/constants");

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 saat
// Bazada tokenin özü yox, SHA-256 hash-ı saxlanılır: baza sızsa belə linklər istifadə oluna bilməz
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

async function createResetLink(Model, id) {
  const token = crypto.randomBytes(32).toString("hex");
  await Model.updateOne({ _id: id }, { resetPasswordToken: hashToken(token), resetPasswordExpires: Date.now() + TOKEN_TTL_MS });
  return `${FRONTEND_URL}/new-password/${token}`;
}
module.exports = { createResetLink, hashToken };
