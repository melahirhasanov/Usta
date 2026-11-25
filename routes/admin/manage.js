// Admin panelin genişləndirilmiş bölmələri. routes/admin.js-dən qoşulur: giriş və admin yoxlaması orada edilib.
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const cloudinary = require("cloudinary").v2;
const Admin = require("../../models/Admin");
const Master = require("../../models/Master");
const Users = require("../../models/User");
const Order = require("../../models/Order");
const Post = require("../../models/Post");
const AdminLog = require("../../models/AdminLog");
const { getSettings, saveSettings, FIELDS } = require("../../models/SiteSettings");
const { CATEGORIES } = require("../../config/constants");
const { checkName, checkPassword, checkPhone, firstError } = require("../../middleware/validate");
const { sendMail, mailMode } = require("../../services/mailer");
const { createResetLink } = require("../../services/resetLink");

const router = express.Router();
const isId = (id) => typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
const ACTIVE = ["pending", "accepted", "on_the_way", "in_progress"];
const escapeRegex = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageOf = (req) => ({ limit: Math.min(parseInt(req.query.limit) || 25, 200), skip: Math.max(parseInt(req.query.skip) || 0, 0) });

const log = (req, action, target, details) =>
  AdminLog.create({ admin: { id: req.account.id, name: req.account.name }, action, target, details: details?.slice(0, 500) }).catch((e) => console.error("Jurnal xətası:", e.message));

// Async xətaları ümumi idarəçiyə ötürür
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.param("id", (req, res, next, id) => (isId(id) ? next() : res.status(404).json({ message: "Tapılmadı" })));

// ---------- Parametrlər ----------
router.get("/settings", wrap(async (req, res) => res.json({ ...(await getSettings()), mail: mailMode() })));
router.put("/settings", wrap(async (req, res) => {
  const update = {};
  for (const f of FIELDS) {
    const v = req.body[f];
    if (v === undefined) continue;
    if (f === "announcement") {
      if (typeof v !== "string" || v.length > 300) return res.status(400).json({ message: "Elan 300 simvoldan çox ola bilməz" });
      update[f] = v.trim();
    } else if (typeof v === "boolean") update[f] = v;
    else return res.status(400).json({ message: "Yanlış dəyər" });
  }
  const saved = await saveSettings(update);
  await log(req, "Parametrlər", "Sayt", JSON.stringify(update));
  res.json({ ...saved, mail: mailMode() });
}));

// Sınaq emaili yalnız adminin öz ünvanına
router.post("/mail/test", wrap(async (req, res) => {
  try {
    await sendMail({ to: req.account.email, subject: "Əlüstü: sınaq emaili", text: "Email göndərmə işləyir." });
    res.json({ message: `Sınaq emaili göndərildi: ${req.account.email}` });
  } catch (e) {
    res.status(502).json({ message: `Göndərilmədi: ${e.message.slice(0, 200)}` });
  }
}));

router.put("/password", wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = await Admin.findById(req.account.id);
  if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, admin.password))) return res.status(400).json({ message: "Cari şifrə yanlışdır" });
  const bad = checkPassword(newPassword) || (newPassword.length < 10 ? "Admin şifrəsi ən azı 10 simvol olmalıdır" : null);
  if (bad) return res.status(400).json({ message: bad });
  admin.password = await bcrypt.hash(newPassword, 12);
  admin.passwordChangedAt = new Date();
  await admin.save();
  await log(req, "Şifrə dəyişdi", "Öz hesabı");
  res.json({ message: "Şifrə dəyişdi, yenidən daxil olun" });
}));

router.get("/logs", wrap(async (req, res) => {
  const { limit, skip } = pageOf(req);
  const [items, total] = await Promise.all([AdminLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), AdminLog.countDocuments()]);
  res.json({ items, total });
}));

// Son 14 günün sifarişləri (qrafik üçün)
router.get("/chart", wrap(async (req, res) => {
  const start = new Date(Date.now() - 13 * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await Order.aggregate([{ $match: { ...Order.OWN, createdAt: { $gte: start } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, n: { $sum: 1 } } }]);
  const map = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  res.json(Array.from({ length: 14 }, (_, i) => { const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10); return { date: d, count: map[d] || 0 }; }));
}));

// ---------- Ustalar ----------
router.put("/masters/:id", wrap(async (req, res) => {
  const u = {};
  for (const k of ["name", "surname", "phone", "city", "category", "bio"]) if (typeof req.body[k] === "string") u[k] = req.body[k].trim();
  if (req.body.experience !== undefined) u.experience = Math.max(0, Math.min(70, Number(req.body.experience) || 0));
  const bad = firstError(
    u.name !== undefined ? checkName(u.name, "Ad") : null,
    u.surname !== undefined ? checkName(u.surname, "Soyad") : null,
    u.phone !== undefined ? checkPhone(u.phone) : null,
    u.category !== undefined && !CATEGORIES.includes(u.category) ? "İxtisas siyahıdan seçilməlidir" : null,
    u.city !== undefined && (!u.city || u.city.length > 50) ? "Şəhər düzgün deyil" : null,
    u.bio !== undefined && u.bio.length > 600 ? "Bio 600 simvoldan çox ola bilməz" : null
  );
  if (bad) return res.status(400).json({ message: bad });
  try {
    const m = await Master.findByIdAndUpdate(req.params.id, u, { new: true, runValidators: true }).select("-password -resetPasswordToken -resetPasswordExpires").lean();
    if (!m) return res.status(404).json({ message: "Tapılmadı" });
    await log(req, "Usta redaktə", `${m.name} ${m.surname}`, Object.keys(u).join(", "));
    res.json(m);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: "Bu telefon artıq istifadə olunur" });
    throw e;
  }
}));

// Toplu əməliyyat. Silmə: aktiv sifarişi olan usta silinmir; sifariş tarixçəsi və yazışmalar saxlanılır.
router.post("/masters/bulk", wrap(async (req, res) => {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || !ids.every(isId)) return res.status(400).json({ message: "1–200 usta seçin" });
  const updates = { block: { isBlocked: true }, unblock: { isBlocked: false }, hide: { isAvailable: false }, show: { isAvailable: true } };
  if (Object.hasOwn(updates, action)) {
    const r = await Master.updateMany({ _id: { $in: ids } }, updates[action]);
    if (action === "block") ids.forEach((id) => req.app.get("disconnectUser")?.(id));
    await log(req, `Toplu: ${action}`, `${r.matchedCount} usta`, ids.join(","));
    return res.json({ done: r.matchedCount, skipped: 0 });
  }
  if (action !== "delete") return res.status(400).json({ message: "Naməlum əməliyyat" });
  const busy = (await Order.distinct("master", { master: { $in: ids }, status: { $in: ACTIVE } })).map(String);
  const del = ids.filter((i) => !busy.includes(i));
  const names = await Master.find({ _id: { $in: del } }).select("name surname profileImageId").lean();
  const posts = await Post.find({ user: { $in: del }, cloudinaryPublicId: { $exists: true } }).select("cloudinaryPublicId mediaType").lean();
  await Post.deleteMany({ user: { $in: del } });
  const r = await Master.deleteMany({ _id: { $in: del } });
  del.forEach((id) => req.app.get("disconnectUser")?.(id));
  await log(req, "Usta silindi", `${r.deletedCount} usta`, names.map((m) => `${m.name} ${m.surname}`).join(", "));
  const files = [...posts.map((p) => [p.cloudinaryPublicId, p.mediaType === "video" ? "video" : "image"]), ...names.filter((m) => m.profileImageId).map((m) => [m.profileImageId, "image"])];
  await Promise.allSettled(files.map(([id, type]) => cloudinary.uploader.destroy(id, { resource_type: type, invalidate: true })));
  res.json({ done: r.deletedCount, skipped: busy.length });
}));

// Email işləməyəndə: admin birdəfəlik bərpa linki yaradıb istifadəçiyə özü göndərir (1 saat etibarlı)
const resetFor = (Model, label) => wrap(async (req, res) => {
  const a = await Model.findById(req.params.id).select("email isDemo").lean();
  if (!a) return res.status(404).json({ message: "Tapılmadı" });
  if (a.isDemo) return res.status(400).json({ message: "Nümunə profilə giriş yoxdur" });
  const link = await createResetLink(Model, a._id);
  await log(req, "Bərpa linki", `${label}: ${a.email}`);
  res.json({ link });
});
router.post("/masters/:id/reset-link", resetFor(Master, "Usta"));
router.post("/customers/:id/reset-link", resetFor(Users, "Müştəri"));

// ---------- Paylaşımlar ----------
router.get("/posts", wrap(async (req, res) => {
  const filter = {};
  if (req.query.demo !== "1") filter.isDemo = { $ne: true };
  if (req.query.q) { const rx = { $regex: escapeRegex(req.query.q), $options: "i" }; filter.$or = [{ title: rx }, { description: rx }]; }
  const { limit, skip } = pageOf(req);
  const [items, total] = await Promise.all([Post.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("user", "name surname").lean(), Post.countDocuments(filter)]);
  res.json({ items, total });
}));
router.delete("/posts/:id", wrap(async (req, res) => {
  const p = await Post.findByIdAndDelete(req.params.id);
  if (!p) return res.status(404).json({ message: "Tapılmadı" });
  await Master.updateOne({ _id: p.user }, { $pull: { posts: p._id } });
  if (p.cloudinaryPublicId) await cloudinary.uploader.destroy(p.cloudinaryPublicId, { resource_type: p.mediaType === "video" ? "video" : "image", invalidate: true }).catch(() => {});
  await log(req, "Paylaşım silindi", p.title);
  res.json({ success: true });
}));

// ---------- Rəylər ----------
router.get("/reviews", wrap(async (req, res) => {
  const filter = { "review.rating": { $exists: true } };
  if (Number(req.query.rating)) filter["review.rating"] = Number(req.query.rating);
  const { limit, skip } = pageOf(req);
  const [items, total] = await Promise.all([Order.find(filter).select("customer.name master category review").sort({ "review.createdAt": -1 }).skip(skip).limit(limit).populate("master", "name surname").lean(), Order.countDocuments(filter)]);
  res.json({ items, total });
}));
router.delete("/reviews/:id", wrap(async (req, res) => {
  const o = await Order.findOneAndUpdate({ _id: req.params.id, "review.rating": { $exists: true } }, { $unset: { review: 1 } });
  if (!o) return res.status(404).json({ message: "Tapılmadı" });
  const [s] = await Order.aggregate([{ $match: { master: o.master, "review.rating": { $exists: true } } }, { $group: { _id: null, avg: { $avg: "$review.rating" }, count: { $sum: 1 } } }]);
  await Master.updateOne({ _id: o.master }, { ratingAvg: Math.round((s?.avg || 0) * 10) / 10, ratingCount: s?.count || 0 });
  await log(req, "Rəy silindi", o.customer.name, `${o.review.rating}★ ${o.review.comment || ""}`);
  res.json({ success: true });
}));

module.exports = { router, log };
