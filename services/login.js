const bcrypt = require("bcryptjs");

// Email hərf böyüklüyünə görə fərqlənmir; köhnə hesablar necə yazılıbsa, elə də tapılır
async function findByEmail(Model, email) {
  const value = String(email).trim();
  return (await Model.findOne({ email: value })) || Model.findOne({ email: value.toLowerCase() });
}

// Hesab olmasa da bcrypt işləyir: cavab vaxtından hesabın mövcudluğu bilinməsin
const DUMMY_HASH = bcrypt.hashSync("hesab-yoxdur", 10);
async function checkLogin(account, password) {
  const ok = await bcrypt.compare(password, account?.password || DUMMY_HASH);
  return Boolean(account) && ok;
}

module.exports = { findByEmail, checkLogin };
