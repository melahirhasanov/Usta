const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Master = require("../models/master");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Kim hansı statusdan hansına keçirə bilər
const TRANSITIONS = {
  master: {
    pending: ["accepted", "rejected"],
    accepted: ["in_progress", "cancelled"],
    in_progress: ["completed"],
  },
  customer: {
    pending: ["cancelled"],
    accepted: ["cancelled"],
  },
};

const MASTER_FIELDS = "name surname category city ratingAvg ratingCount location";

const isParticipant = (order, account) =>
  account.role === "master"
    ? String(order.master._id || order.master) === account.id
    : String(order.customer.id) === account.id;

// Sifariş dəyişəndə hər iki tərəfə canlı bildiriş
function notify(req, order) {
  const notifyUsers = req.app.get("notifyUsers");
  if (!notifyUsers) return;
  notifyUsers([order.customer.email, String(order.master._id || order.master)], "order_updated", {
    _id: order._id,
    status: order.status,
  });
}

// Yeni sifariş (yalnız müştəri)
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { masterId, description, address, latitude, longitude, scheduledAt } = req.body;
    if (!mongoose.Types.ObjectId.isValid(masterId)) return res.status(400).json({ message: "Usta seçilməyib" });
    if (!description?.trim() || !address?.trim()) {
      return res.status(400).json({ message: "İşin təsviri və ünvan tələb olunur" });
    }
    const master = await Master.findById(masterId).select("category isAvailable isBlocked");
    if (!master || master.isBlocked) return res.status(404).json({ message: "Usta tapılmadı" });
    if (master.isAvailable === false) return res.status(400).json({ message: "Usta hazırda sifariş qəbul etmir" });

    const order = await Order.create({
      customer: { id: req.account.id, email: req.account.email, name: req.account.name },
      master: master._id,
      category: master.category,
      description,
      address,
      location: latitude != null && longitude != null ? { type: "Point", coordinates: [Number(longitude), Number(latitude)] } : undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
      history: [{ status: "pending", by: "customer" }],
    });
    await order.populate("master", MASTER_FIELDS);
    notify(req, order);
    res.status(201).json(order);
  } catch (error) {
    console.error("Sifariş yaradılmadı:", error.message);
    res.status(400).json({ message: "Sifariş yaradılmadı" });
  }
});

// Mənim sifarişlərim (müştəri və ya usta)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const filter = req.account.role === "master" ? { master: req.account.id } : { "customer.id": req.account.id };
    const orders = await Order.find(filter).sort({ createdAt: -1 }).populate("master", MASTER_FIELDS).lean();
    res.json(orders);
  } catch (error) {
    console.error("Sifarişlər yüklənmədi:", error.message);
    res.status(500).json({ message: "Sifarişlər yüklənmədi" });
  }
});

// Status dəyişikliyi
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { status, price, masterNote } = req.body;
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: "Sifariş tapılmadı" });
    const order = await Order.findById(req.params.id);
    if (!order || !isParticipant(order, req.account)) return res.status(404).json({ message: "Sifariş tapılmadı" });

    const allowed = TRANSITIONS[req.account.role][order.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: "Bu əməliyyat sifarişin indiki vəziyyətində mümkün deyil" });
    }

    order.status = status;
    order.history.push({ status, by: req.account.role });
    if (req.account.role === "master") {
      if (price != null && price !== "") order.price = Number(price);
      if (masterNote) order.masterNote = masterNote;
    }
    await order.save();

    if (status === "completed") {
      await Master.updateOne({ _id: order.master }, { $inc: { completedOrders: 1 } });
    }

    await order.populate("master", MASTER_FIELDS);
    notify(req, order);
    res.json(order);
  } catch (error) {
    console.error("Status dəyişmədi:", error.message);
    res.status(400).json({ message: "Status dəyişmədi" });
  }
});

// Rəy (müştəri, tamamlanmış sifariş, bir dəfə)
router.post("/:id/review", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || "").trim();
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ message: "Qiymət 1-5 arası olmalıdır" });
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ message: "Sifariş tapılmadı" });

    const order = await Order.findById(req.params.id);
    if (!order || !isParticipant(order, req.account)) return res.status(404).json({ message: "Sifariş tapılmadı" });
    if (order.status !== "completed") return res.status(400).json({ message: "Rəy yalnız tamamlanmış sifarişə yazıla bilər" });
    if (order.review?.rating) return res.status(400).json({ message: "Bu sifarişə artıq rəy yazılıb" });

    order.review = { rating, comment, createdAt: new Date() };
    await order.save();

    // Ustanın orta reytinqini yenidən hesabla
    const [stats] = await Order.aggregate([
      { $match: { master: order.master, "review.rating": { $exists: true } } },
      { $group: { _id: null, avg: { $avg: "$review.rating" }, count: { $sum: 1 } } },
    ]);
    await Master.updateOne(
      { _id: order.master },
      { ratingAvg: Math.round((stats?.avg || 0) * 10) / 10, ratingCount: stats?.count || 0 }
    );

    await order.populate("master", MASTER_FIELDS);
    notify(req, order);
    res.json(order);
  } catch (error) {
    console.error("Rəy yazılmadı:", error.message);
    res.status(400).json({ message: "Rəy yazılmadı" });
  }
});

// Ustanın ictimai rəyləri + şəffaf reytinq xülasəsi
// Reytinq = tamamlanmış sifarişlərə yazılmış bütün rəylərin sadə ədədi ortası (çəki, gizli əmsal yoxdur)
router.get("/reviews/:masterId", async (req, res) => {
  try {
    const empty = { summary: { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, completedOrders: 0 }, reviews: [] };
    if (!mongoose.Types.ObjectId.isValid(req.params.masterId)) return res.json(empty);
    const masterId = new mongoose.Types.ObjectId(req.params.masterId);

    const [dist, completedOrders, orders] = await Promise.all([
      Order.aggregate([
        { $match: { master: masterId, "review.rating": { $exists: true } } },
        { $group: { _id: "$review.rating", count: { $sum: 1 } } },
      ]),
      Order.countDocuments({ master: masterId, status: "completed" }),
      Order.find({ master: masterId, "review.rating": { $exists: true } })
        .sort({ "review.createdAt": -1 })
        .limit(50)
        .select("customer.name category review")
        .lean(),
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let count = 0;
    for (const d of dist) {
      distribution[d._id] = d.count;
      sum += d._id * d.count;
      count += d.count;
    }

    res.json({
      summary: { average: count ? Math.round((sum / count) * 10) / 10 : 0, sum, count, distribution, completedOrders },
      reviews: orders.map((o) => ({
        _id: o._id,
        // Müştərinin tam adı yox, yalnız ilk adı və soyadın ilk hərfi göstərilir
        customerName: (o.customer?.name || "Müştəri").split(" ").map((p, i) => (i === 0 ? p : `${p[0]}.`)).join(" "),
        category: o.category,
        rating: o.review.rating,
        comment: o.review.comment,
        createdAt: o.review.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "Rəylər yüklənmədi" });
  }
});

module.exports = router;
