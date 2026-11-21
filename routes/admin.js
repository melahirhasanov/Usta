const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Master = require("../models/master");
const Users = require("../models/Users");
const Order = require("../models/Order");
const Complaint = require("../models/Complaint");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const escapeRegex = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const pageOf = (req) => ({ limit: Math.min(parseInt(req.query.limit) || 50, 200), skip: parseInt(req.query.skip) || 0 });

// Admin girişi
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string") return res.status(400).json({ message: "Email və şifrə tələb olunur" });
  const admin = await Admin.findOne({ email: email.trim() });
  if (!admin || !(await bcrypt.compare(password, admin.password))) {
    return res.status(400).json({ message: "Daxil etdiyiniz məlumatlar yanlışdır" });
  }
  const token = jwt.sign({ id: admin._id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: { id: admin._id, name: admin.name, email: admin.email } });
});

// Bütün aşağıdakılar yalnız admin üçündür
router.use(requireAuth, requireRole("admin"));

// İcmal: əsas rəqəmlər
router.get("/stats", async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const [masters, availableMasters, blockedMasters, customers, ordersByStatus, ordersWeek, complaintsOpen, ratingAgg] = await Promise.all([
    Master.countDocuments(),
    Master.countDocuments({ isAvailable: { $ne: false }, isBlocked: { $ne: true } }),
    Master.countDocuments({ isBlocked: true }),
    Users.countDocuments(),
    Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.countDocuments({ createdAt: { $gte: weekAgo } }),
    Complaint.countDocuments({ status: { $in: ["open", "in_review"] } }),
    Order.aggregate([{ $match: { "review.rating": { $exists: true } } }, { $group: { _id: null, avg: { $avg: "$review.rating" }, count: { $sum: 1 } } }]),
  ]);
  const orders = Object.fromEntries(ordersByStatus.map((o) => [o._id, o.count]));
  res.json({
    masters,
    availableMasters,
    blockedMasters,
    customers,
    orders,
    ordersTotal: ordersByStatus.reduce((s, o) => s + o.count, 0),
    ordersWeek,
    complaintsOpen,
    reviews: { average: ratingAgg[0] ? Math.round(ratingAgg[0].avg * 10) / 10 : 0, count: ratingAgg[0]?.count || 0 },
  });
});

// ---------- Şikayətlər ----------
router.get("/complaints", async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const { limit, skip } = pageOf(req);
  const [items, total] = await Promise.all([
    Complaint.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("order", "status description category").lean(),
    Complaint.countDocuments(filter),
  ]);
  res.json({ items, total });
});

router.patch("/complaints/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Tapılmadı" });
  const { status, adminNote } = req.body;
  if (status && !Complaint.STATUSES.includes(status)) return res.status(400).json({ message: "Yanlış status" });
  const update = {};
  if (status) {
    update.status = status;
    update.resolvedAt = ["resolved", "rejected"].includes(status) ? new Date() : null;
  }
  if (adminNote !== undefined) update.adminNote = adminNote;
  const c = await Complaint.findByIdAndUpdate(req.params.id, update, { new: true }).populate("order", "status description category");
  if (!c) return res.status(404).json({ message: "Tapılmadı" });
  res.json(c);
});

// ---------- Sifarişlər ----------
router.get("/orders", async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
    filter.$or = [{ "customer.name": rx }, { "customer.email": rx }, { description: rx }, { address: rx }, { category: rx }];
  }
  const { limit, skip } = pageOf(req);
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("master", "name surname email category").lean(),
    Order.countDocuments(filter),
  ]);
  res.json({ items, total });
});

// Admin aktiv sifarişi ləğv edə bilər (məs. şikayətdən sonra)
router.patch("/orders/:id/cancel", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Tapılmadı" });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: "Tapılmadı" });
  if (["completed", "cancelled", "rejected"].includes(order.status)) {
    return res.status(400).json({ message: "Bu sifariş artıq bağlanıb" });
  }
  order.status = "cancelled";
  order.history.push({ status: "cancelled", by: "admin" });
  order.masterNote = order.masterNote || undefined;
  await order.save({ validateBeforeSave: false });
  req.app.get("notifyUsers")?.([order.customer.email, String(order.master)], "order_updated", { _id: order._id, status: order.status });
  await order.populate("master", "name surname email category");
  res.json(order);
});

// ---------- Ustalar ----------
router.get("/masters", async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
    filter.$or = [{ name: rx }, { surname: rx }, { email: rx }, { category: rx }, { city: rx }, { phone: rx }];
  }
  if (req.query.blocked === "1") filter.isBlocked = true;
  const { limit, skip } = pageOf(req);
  const [items, total, complaintCounts] = await Promise.all([
    Master.find(filter).select("-password -resetPasswordToken -resetPasswordExpires -followers -following -posts").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Master.countDocuments(filter),
    Complaint.aggregate([{ $match: { "target.type": "master" } }, { $group: { _id: "$target.id", count: { $sum: 1 } } }]),
  ]);
  const complaints = Object.fromEntries(complaintCounts.map((c) => [c._id, c.count]));
  res.json({ items: items.map((m) => ({ ...m, complaints: complaints[String(m._id)] || 0 })), total });
});

router.patch("/masters/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Tapılmadı" });
  const update = {};
  if (req.body.isBlocked !== undefined) update.isBlocked = Boolean(req.body.isBlocked);
  if (req.body.isAvailable !== undefined) update.isAvailable = Boolean(req.body.isAvailable);
  const m = await Master.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password -resetPasswordToken -resetPasswordExpires").lean();
  if (!m) return res.status(404).json({ message: "Tapılmadı" });
  res.json(m);
});

// ---------- Müştərilər ----------
router.get("/customers", async (req, res) => {
  const filter = {};
  if (req.query.q) {
    const rx = { $regex: escapeRegex(req.query.q), $options: "i" };
    filter.$or = [{ username: rx }, { email: rx }];
  }
  const { limit, skip } = pageOf(req);
  const [items, total, orderCounts] = await Promise.all([
    Users.find(filter).select("username email phoneNumber isBlocked").sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    Users.countDocuments(filter),
    Order.aggregate([{ $group: { _id: "$customer.id", count: { $sum: 1 } } }]),
  ]);
  const orders = Object.fromEntries(orderCounts.map((o) => [String(o._id), o.count]));
  res.json({ items: items.map((u) => ({ ...u, orders: orders[String(u._id)] || 0 })), total });
});

router.patch("/customers/:id", async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: "Tapılmadı" });
  const u = await Users.findByIdAndUpdate(req.params.id, { isBlocked: Boolean(req.body.isBlocked) }, { new: true })
    .select("username email phoneNumber isBlocked")
    .lean();
  if (!u) return res.status(404).json({ message: "Tapılmadı" });
  res.json(u);
});

module.exports = router;
