const express = require("express");
const mongoose = require("mongoose");
const Message = require("../models/message");
const { requireAuth } = require("../middleware/auth");
const { belongsToRoom, resolveReceiver } = require("../socket");

const router = express.Router();

// Köhnə mesajlarda receiverId ObjectId kimi saxlanılıb, yenilərində string
const idVariants = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? [id, new mongoose.Types.ObjectId(id)] : [id];

// Bütün endpoint-lər yalnız daxil olmuş istifadəçi və yalnız öz söhbətləri üçündür
router.use(requireAuth);

const ownRoom = (req, res, next) =>
  belongsToRoom(req.params.roomId, req.account.chatId) ? next() : res.status(403).json({ message: "İcazə yoxdur" });

// İstifadəçinin bütün söhbətləri (son mesaj, oxunmamış say, qarşı tərəf)
router.get("/conversations", async (req, res) => {
  try {
    const me = req.account.chatId;
    const conversations = await Message.aggregate([
      { $match: { $or: [{ senderId: me }, { receiverId: { $in: idVariants(me) } }] } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$roomId",
          lastMessage: { $first: "$message" },
          lastMessageTime: { $first: "$createdAt" },
          lastSenderId: { $first: "$senderId" },
          otherUserId: { $first: { $cond: [{ $eq: ["$senderId", me] }, { $toString: "$receiverId" }, "$senderId"] } },
          otherUserName: { $first: { $cond: [{ $eq: ["$senderId", me] }, "$receiverName", "$senderName"] } },
          unreadCount: { $sum: { $cond: [{ $and: [{ $ne: ["$senderId", me] }, { $eq: ["$isRead", false] }] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          roomId: "$_id",
          lastMessage: 1,
          lastMessageTime: 1,
          lastSenderId: 1,
          unreadCount: 1,
          user: { _id: "$otherUserId", name: "$otherUserName" },
        },
      },
      { $sort: { lastMessageTime: -1 } },
    ]);
    res.json({ success: true, data: conversations });
  } catch (error) {
    console.error("Söhbətlər gətirilmə xətası:", error.message);
    res.status(500).json({ success: false, message: "Söhbətlər gətirilə bilmədi" });
  }
});

// Otaqdakı mesajlar
router.get("/room/:roomId", ownRoom, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const messages = await Message.find({ roomId: req.params.roomId }).sort({ createdAt: 1 }).limit(limit).lean();
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: "Mesajlar gətirilə bilmədi" });
  }
});

// Otaqdakı qarşı tərəfin mesajlarını oxundu et; göndərənə "oxundu" bildirişi
router.put("/room/:roomId/read-all", ownRoom, async (req, res) => {
  try {
    const me = req.account.chatId;
    const result = await Message.updateMany({ roomId: req.params.roomId, senderId: { $ne: me }, isRead: false }, { isRead: true });
    if (result.modifiedCount > 0) {
      const notifyUsers = req.app.get("notifyUsers");
      const other = req.params.roomId.startsWith(`${me}_`) ? req.params.roomId.slice(me.length + 1) : req.params.roomId.slice(0, -(me.length + 1));
      notifyUsers?.([other], "messages_read", { roomId: req.params.roomId });
    }
    res.json({ success: true, updatedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ success: false, message: "Mesajlar oxundu edilə bilmədi" });
  }
});

// Socket bağlantısı olmadıqda REST ilə mesaj göndərmə
router.post("/", async (req, res) => {
  try {
    const { roomId, message, tempId } = req.body;
    const text = typeof message === "string" ? message.trim() : "";
    const receiver = text ? await resolveReceiver(roomId, req.account) : null;
    if (!receiver) return res.status(400).json({ success: false, message: "Mesaj göndərilə bilmədi" });
    const doc = await Message.create({
      roomId,
      senderId: req.account.chatId,
      senderName: req.account.name,
      receiverId: receiver.id,
      receiverName: receiver.name,
      message: text.slice(0, 2000),
      isRead: false,
    });
    req.app.get("broadcastMessage")?.(doc, tempId);
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    console.error("Mesaj göndərmə xətası:", error.message);
    res.status(500).json({ success: false, message: "Mesaj göndərilə bilmədi" });
  }
});

module.exports = router;
