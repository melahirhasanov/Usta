const express = require("express");
const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const Order = require("../models/Order");
const Master = require("../models/Master");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Şikayət göndər: müştəri ustadan, usta müştəridən (sifariş üzrə)
router.post("/", requireAuth, requireRole("customer", "master"), async (req, res) => {
  try {
    const { masterId, orderId, reason, description } = req.body;
    if (!Complaint.REASONS.includes(reason)) return res.status(400).json({ message: "Şikayətin səbəbini seçin" });
    if (!description || String(description).trim().length < 10) {
      return res.status(400).json({ message: "Problemi ən azı 10 simvolla təsvir edin" });
    }

    let target;
    let order;
    if (orderId) {
      if (!mongoose.Types.ObjectId.isValid(orderId)) return res.status(404).json({ message: "Sifariş tapılmadı" });
      order = await Order.findById(orderId).populate("master", "name surname");
      const mine =
        order &&
        (req.account.role === "master" ? String(order.master?._id) === req.account.id : String(order.customer.id) === req.account.id);
      if (!mine) return res.status(404).json({ message: "Sifariş tapılmadı" });
      target =
        req.account.role === "master"
          ? { type: "customer", id: String(order.customer.id), name: order.customer.name }
          : !order.master ? null : { type: "master", id: String(order.master._id), name: `${order.master.name} ${order.master.surname}` };
    } else {
      // Sifarişsiz şikayət yalnız ustaya qarşı (profil səhifəsindən)
      if (!mongoose.Types.ObjectId.isValid(masterId)) return res.status(400).json({ message: "Usta seçilməyib" });
      const master = await Master.findById(masterId).select("name surname");
      if (!master) return res.status(404).json({ message: "Usta tapılmadı" });
      if (String(master._id) === req.account.id) return res.status(400).json({ message: "Özünüzdən şikayət edə bilməzsiniz" });
      target = { type: "master", id: String(master._id), name: `${master.name} ${master.surname}` };
    }

    if (!target) return res.status(400).json({ message: "Bu sifarişin ustasının hesabı silinib" });

    const complaint = await Complaint.create({
      reporter: { role: req.account.role, id: req.account.id, name: req.account.name, email: req.account.email },
      target,
      order: order?._id,
      reason,
      description: String(description).trim(),
    });
    res.status(201).json(complaint);
  } catch (error) {
    console.error("Şikayət yaradılmadı:", error.message);
    res.status(400).json({ message: "Şikayət göndərilmədi" });
  }
});

// Mənim şikayətlərim (status izləmək üçün)
router.get("/mine", requireAuth, async (req, res) => {
  const list = await Complaint.find({ "reporter.id": req.account.id }).sort({ createdAt: -1 }).lean();
  res.json(list);
});

module.exports = router;
