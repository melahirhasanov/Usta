const jwt = require("jsonwebtoken");
const Users = require("../models/Users");
const Master = require("../models/master");
const Admin = require("../models/Admin");

/**
 * JWT-dən hesabı müəyyən edir.
 * Qaytarır: { id, role: "customer" | "master" | "admin", chatId, name, email }
 * chatId — chat və zənglərdə istifadə olunan ID (usta üçün Mongo ID, müştəri üçün email; köhnə mesajlarla uyğunluq).
 * Köhnə tokenlərdə "role" yoxdur — belə halda hesab usta və müştəri kolleksiyalarında axtarılır.
 * Bloklanmış hesablar rədd edilir.
 */
// Şifrə dəyişdikdən əvvəl verilmiş tokenlər (məs. oğurlanmış) artıq etibarlı deyil
const issuedBeforePasswordChange = (payload, account) =>
  account.passwordChangedAt && payload.iat * 1000 < new Date(account.passwordChangedAt).getTime() - 1000;

async function resolveAccount(token) {
  // Alqoritm sabitlənir: "alg: none" və ya başqa alqoritmlə saxta token qəbul edilmir
  const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });

  if (payload.role === "admin") {
    const a = await Admin.findById(payload.id).select("name email").lean();
    if (a) return { id: String(a._id), role: "admin", chatId: `admin:${a._id}`, name: a.name, email: a.email };
    throw new Error("Hesab tapılmadı");
  }

  const lookups = payload.role === "master" ? ["master"] : payload.role === "customer" ? ["customer"] : ["master", "customer"];
  for (const role of lookups) {
    if (role === "master") {
      const m = await Master.findById(payload.id).select("name surname email isBlocked passwordChangedAt").lean();
      if (m) {
        if (m.isBlocked) throw new Error("blocked");
        if (issuedBeforePasswordChange(payload, m)) throw new Error("expired");
        return { id: String(m._id), role, chatId: String(m._id), name: `${m.name} ${m.surname}`, email: m.email };
      }
    } else {
      const u = await Users.findById(payload.id).select("username email isBlocked passwordChangedAt").lean();
      if (u) {
        if (u.isBlocked) throw new Error("blocked");
        if (issuedBeforePasswordChange(payload, u)) throw new Error("expired");
        return { id: String(u._id), role, chatId: u.email, name: u.username || u.email, email: u.email };
      }
    }
  }
  throw new Error("Hesab tapılmadı");
}

const bearer = (req) => {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Authorization: Bearer <token> — req.userId və req.account təyin olunur
async function requireAuth(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ message: "Giriş tələb olunur" });
  try {
    req.account = await resolveAccount(token);
    req.userId = req.account.id;
    next();
  } catch (e) {
    const message = e.message === "blocked" ? "Hesabınız administrator tərəfindən bloklanıb" : "Sessiyanın vaxtı bitib, yenidən daxil olun";
    return res.status(401).json({ message });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.account?.role) ? next() : res.status(403).json({ message: "Bu əməliyyat üçün icazəniz yoxdur" });

module.exports = { requireAuth, requireRole, resolveAccount };
