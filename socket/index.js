const socketIo = require("socket.io");
const mongoose = require("mongoose");
const Message = require("../models/message");
const Master = require("../models/master");
const Users = require("../models/Users");
const Order = require("../models/Order");
const { resolveAccount } = require("../middleware/auth");

// Otaq ID formatı: "<müştəri email>_<usta ID>" — istifadəçi yalnız öz ID-si olan otağa qoşula bilər
const belongsToRoom = (roomId, chatId) =>
  typeof roomId === "string" && (roomId.startsWith(`${chatId}_`) || roomId.endsWith(`_${chatId}`));

/**
 * Otaqdakı qarşı tərəfi serverdə müəyyən edir (client-in göndərdiyi receiverId-yə etibar edilmir).
 * Müştəri yazırsa qarşı tərəf ustadır (mövcud olmalıdır), usta yazırsa — müştəri.
 * Qaytarır: { id, name } və ya null
 */
async function resolveReceiver(roomId, account) {
  if (!belongsToRoom(roomId, account.chatId)) return null;
  if (account.role === "customer") {
    const masterId = roomId.slice(account.chatId.length + 1);
    if (!mongoose.Types.ObjectId.isValid(masterId)) return null;
    const m = await Master.findOne({ _id: masterId, isBlocked: { $ne: true }, isDemo: { $ne: true } }).select("name surname").lean();
    return m ? { id: String(m._id), name: `${m.name} ${m.surname}` } : null;
  }
  if (account.role === "master") {
    const email = roomId.slice(0, -(account.chatId.length + 1));
    const u = await Users.findOne({ email }).select("username email").lean();
    return u ? { id: u.email, name: u.username || u.email } : null;
  }
  return null;
}

// Hər socket üçün sadə flood limiti: windowMs ərzində ən çox `max` hadisə
function eventLimiter(max, windowMs) {
  let count = 0;
  let resetAt = Date.now() + windowMs;
  return () => {
    const now = Date.now();
    if (now > resetAt) {
      count = 0;
      resetAt = now + windowMs;
    }
    count += 1;
    return count <= max;
  };
}

function setupSocket(server, app, allowedOrigins) {
  const io = socketIo(server, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
  });

  // chatId -> Set(socketId) (eyni istifadəçi bir neçə tabda ola bilər)
  const onlineUsers = new Map();

  const socketsOf = (chatId) => [...(onlineUsers.get(String(chatId)) || [])];

  function notifyUsers(chatIds, event, payload) {
    const targets = chatIds.flatMap(socketsOf);
    if (targets.length) io.to(targets).emit(event, payload);
  }

  // Mesajı otağa, qəbul edənə və göndərənə çatdırır (tempId — optimistik mesajı əvəz etmək üçün)
  function broadcastMessage(messageDoc, tempId) {
    const payload = { ...messageDoc.toObject(), timestamp: messageDoc.createdAt, tempId };
    const targets = [...socketsOf(messageDoc.receiverId), ...socketsOf(messageDoc.senderId)];
    io.to([messageDoc.roomId, ...targets]).emit("receive_message", payload);
  }

  app.set("broadcastMessage", broadcastMessage);
  app.set("notifyUsers", notifyUsers);
  app.set("isOnline", (chatId) => onlineUsers.has(String(chatId)));
  app.set("onlineIds", () => [...onlineUsers.keys()]);

  // Hər bağlantı JWT ilə yoxlanılır; kimlik client-in dediyindən yox, tokendən götürülür
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("unauthorized"));
      socket.data.account = await resolveAccount(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { chatId, name, role } = socket.data.account;
    const allowMessage = eventLimiter(20, 10000); // 10 saniyədə 20 mesaj
    const allowCall = eventLimiter(5, 60000); // dəqiqədə 5 zəng cəhdi

    const set = onlineUsers.get(chatId) || new Set();
    const wasOffline = set.size === 0;
    set.add(socket.id);
    onlineUsers.set(chatId, set);
    if (wasOffline) io.emit("user_status", { userId: chatId, userName: name, userType: role, isOnline: true });

    socket.on("join_room", ({ roomId } = {}) => {
      if (belongsToRoom(roomId, chatId)) socket.join(roomId);
    });

    socket.on("leave_room", ({ roomId } = {}) => {
      if (roomId) socket.leave(roomId);
    });

    socket.on("send_message", async (data = {}) => {
      const { roomId, message, tempId } = data;
      try {
        if (!allowMessage()) return socket.emit("message_error", { tempId, message: "Çox tez-tez yazırsınız, bir az gözləyin" });
        const text = typeof message === "string" ? message.trim() : "";
        const receiver = text ? await resolveReceiver(roomId, socket.data.account) : null;
        if (!receiver) return socket.emit("message_error", { tempId, message: "Mesaj göndərilə bilmədi" });
        const doc = await Message.create({
          roomId,
          senderId: chatId,
          senderName: name,
          receiverId: receiver.id,
          receiverName: receiver.name,
          message: text.slice(0, 2000),
          isRead: false,
        });
        broadcastMessage(doc, tempId);
      } catch (error) {
        console.error("Mesaj göndərmə xətası:", error.message);
        socket.emit("message_error", { tempId, message: "Mesaj göndərilə bilmədi" });
      }
    });

    socket.on("typing_indicator", ({ roomId, isTyping } = {}) => {
      if (belongsToRoom(roomId, chatId)) socket.to(roomId).emit("typing_indicator", { roomId, userId: chatId, isTyping });
    });

    // ---------- Ustanın canlı yeri (sifariş "Yoldadır" statusunda) ----------
    // Usta yalnız öz sifarişi üçün yer göndərə bilər; yer müştəriyə ötürülür və sifarişdə saxlanılır
    const allowLocation = eventLimiter(30, 60000); // dəqiqədə ən çox 30 yeniləmə
    const trackCache = new Map(); // orderId -> { customer, until }
    socket.on("order:location", async ({ orderId, lat, lng } = {}) => {
      try {
        if (role !== "master" || !allowLocation()) return;
        if (!mongoose.Types.ObjectId.isValid(orderId) || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
        let entry = trackCache.get(orderId);
        if (!entry || entry.until < Date.now()) {
          const order = await Order.findOne({ _id: orderId, master: chatId, status: "on_the_way" }).select("customer.email").lean();
          if (!order) return trackCache.delete(orderId);
          entry = { customer: order.customer.email, until: Date.now() + 20000 };
          trackCache.set(orderId, entry);
        }
        const at = new Date();
        await Order.updateOne({ _id: orderId, status: "on_the_way" }, { tracking: { lat, lng, at } });
        notifyUsers([entry.customer, chatId], "order_location", { orderId, lat, lng, at });
      } catch (error) {
        console.error("Yer yeniləmə xətası:", error.message);
      }
    });

    // ---------- Zəng siqnalları (WebRTC). Səs birbaşa brauzerlər arasında gedir, nömrə paylaşılmır ----------
    const relay = (event, to, payload) => {
      const targets = socketsOf(to);
      if (targets.length) io.to(targets).emit(event, { ...payload, from: chatId, fromName: name, fromRole: role });
      return targets.length > 0;
    };

    socket.on("call:offer", ({ to, sdp, callId } = {}) => {
      if (!to || to === chatId || typeof to !== "string") return;
      if (!allowCall()) return socket.emit("call:unavailable", { callId });
      const delivered = relay("call:incoming", to, { sdp, callId });
      if (!delivered) socket.emit("call:unavailable", { callId });
    });
    socket.on("call:answer", ({ to, sdp, callId } = {}) => {
      // Cavab verildi: zəngi qəbul edənin digər tablarında zəng səsini dayandır
      relay("call:answered", to, { sdp, callId });
      socketsOf(chatId).filter((id) => id !== socket.id).forEach((id) => io.to(id).emit("call:taken", { callId }));
    });
    socket.on("call:ice", ({ to, candidate, callId } = {}) => relay("call:ice", to, { candidate, callId }));
    socket.on("call:reject", ({ to, callId } = {}) => relay("call:rejected", to, { callId }));
    socket.on("call:end", ({ to, callId } = {}) => relay("call:ended", to, { callId }));

    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(chatId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(chatId);
        io.emit("user_status", { userId: chatId, userName: name, userType: role, isOnline: false });
      }
    });
  });

  return io;
}

module.exports = { setupSocket, belongsToRoom, resolveReceiver };
