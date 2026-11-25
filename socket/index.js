const socketIo = require("socket.io");
const mongoose = require("mongoose");
const Message = require("../models/Message");
const Master = require("../models/Master");
const Users = require("../models/User");
const Order = require("../models/Order");
const { resolveAccount } = require("../middleware/auth");

// Otaq ID formatı: "<müştəri email>_<usta ID (24 hex)>". Sonuncu "_" dəqiq ayırıcıdır.
function parseRoom(roomId) {
  const m = typeof roomId === "string" && roomId.length < 200 ? /^(.+)_([0-9a-f]{24})$/.exec(roomId) : null;
  return m ? { email: m[1], masterId: m[2] } : null;
}
// İstifadəçi yalnız rolunun tərəfində dəqiq özü olan otağa aiddir (oxşar/prefiks email ilə girmək olmaz)
function belongsToRoom(roomId, account) {
  const r = parseRoom(roomId);
  if (!r) return false;
  return (account.role === "customer" && r.email === account.chatId) || (account.role === "master" && r.masterId === account.chatId);
}
const otherSide = (roomId, account) => (account.role === "customer" ? parseRoom(roomId).masterId : parseRoom(roomId).email);

/**
 * Otaqdakı qarşı tərəfi serverdə müəyyən edir (client-in göndərdiyi receiverId-yə etibar edilmir).
 * Müştəri yazırsa qarşı tərəf ustadır (mövcud olmalıdır), usta yazırsa — müştəri.
 * Qaytarır: { id, name } və ya null
 */
async function resolveReceiver(roomId, account) {
  if (!belongsToRoom(roomId, account)) return null;
  if (account.role === "customer") {
    const masterId = otherSide(roomId, account);
    const m = await Master.findOne({ _id: masterId, isBlocked: { $ne: true }, isDemo: { $ne: true } }).select("name surname").lean();
    return m ? { id: String(m._id), name: `${m.name} ${m.surname}` } : null;
  }
  if (account.role === "master") {
    const email = otherSide(roomId, account);
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
    maxHttpBufferSize: 100 * 1024, // zəng SDP-si üçün kifayətdir
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
  const isMasterId = (id) => /^[0-9a-f]{24}$/.test(id);
  app.set("onlineMasterIds", () => [...onlineUsers.keys()].filter(isMasterId));
  // Bloklanan/silinən hesabın açıq bağlantıları dərhal kəsilir
  app.set("disconnectUser", (chatId) => socketsOf(chatId).forEach((id) => io.sockets.sockets.get(id)?.disconnect(true)));

  // Müştərinin onlayn statusu yalnız yazışdığı ustalara bildirilir (email başqasına getmir)
  const partnersOf = (account) =>
    account.role === "customer"
      ? Message.distinct("roomId", { $or: [{ senderId: account.chatId }, { receiverId: account.chatId }] }).then((rooms) => rooms.filter((r) => belongsToRoom(r, account)).map((r) => otherSide(r, account)))
      : Promise.resolve([]);
  async function announce(account, isOnline) {
    const payload = { userId: account.chatId, userType: account.role, isOnline };
    if (account.role === "master") return io.emit("user_status", payload);
    if (account.role === "customer") notifyUsers(await partnersOf(account), "user_status", payload);
  }
  // Ustaya qoşulanda onlayn müştərilərini göstər
  async function sendPresence(socket, account) {
    if (account.role !== "master") return;
    const rooms = await Message.distinct("roomId", { $or: [{ senderId: account.chatId }, { receiverId: account.chatId }] });
    for (const r of rooms) if (belongsToRoom(r, account) && onlineUsers.has(otherSide(r, account))) socket.emit("user_status", { userId: otherSide(r, account), userType: "customer", isOnline: true });
  }
  // Zəng: müştəri istənilən ustaya, usta isə yalnız yazışdığı və ya sifarişi olan müştəriyə
  async function mayCall(account, to) {
    if (account.role === "customer") return isMasterId(to) && Boolean(await Master.exists({ _id: to, isBlocked: { $ne: true }, isDemo: { $ne: true } }));
    if (account.role !== "master") return false;
    return Boolean((await Message.exists({ roomId: `${to}_${account.chatId}` })) || (await Order.exists({ "customer.email": to, master: account.chatId })));
  }
  const calls = new Map(); // callId -> { a, b, at }: yalnız bu iki tərəf siqnal göndərə bilər
  setInterval(() => { const old = Date.now() - 3 * 3600000; for (const [k, v] of calls) if (v.at < old) calls.delete(k); }, 600000).unref();

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
    const account = socket.data.account;
    const { chatId, name, role } = account;
    // Pozuq paket (null, sətir, rəqəm...) və handler xətası serveri çökdürməsin
    const on = (event, handler) =>
      socket.on(event, async (data) => {
        try {
          await handler(data && typeof data === "object" && !Array.isArray(data) ? data : {});
        } catch (e) {
          console.error(`Socket ${event} xətası:`, e.message);
        }
      });
    const allowSignal = eventLimiter(300, 60000); // ICE namizədləri üçün geniş limit
    const allowMessage = eventLimiter(20, 10000); // 10 saniyədə 20 mesaj
    const allowCall = eventLimiter(5, 60000); // dəqiqədə 5 zəng cəhdi

    const set = onlineUsers.get(chatId) || new Set();
    const wasOffline = set.size === 0;
    set.add(socket.id);
    onlineUsers.set(chatId, set);
    if (wasOffline) announce(account, true).catch(() => {});
    sendPresence(socket, account).catch(() => {});

    on("join_room", ({ roomId } = {}) => {
      if (belongsToRoom(roomId, account)) socket.join(roomId);
    });

    on("leave_room", ({ roomId } = {}) => {
      if (typeof roomId === "string") socket.leave(roomId);
    });

    on("send_message", async (data = {}) => {
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

    on("typing_indicator", ({ roomId, isTyping } = {}) => {
      if (allowSignal() && belongsToRoom(roomId, account)) socket.to(roomId).emit("typing_indicator", { roomId, userId: chatId, isTyping: Boolean(isTyping) });
    });

    // ---------- Ustanın canlı yeri (sifariş "Yoldadır" statusunda) ----------
    // Usta yalnız öz sifarişi üçün yer göndərə bilər; yer müştəriyə ötürülür və sifarişdə saxlanılır
    const allowLocation = eventLimiter(30, 60000); // dəqiqədə ən çox 30 yeniləmə
    const trackCache = new Map(); // orderId -> { customer, until }
    on("order:location", async ({ orderId, lat, lng } = {}) => {
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

    const peer = (to, callId) => {
      const c = typeof callId === "string" ? calls.get(callId) : null;
      return c && allowSignal() && ((c.a === chatId && c.b === to) || (c.b === chatId && c.a === to));
    };
    on("call:offer", async ({ to, sdp, callId }) => {
      if (typeof to !== "string" || to === chatId || typeof callId !== "string" || callId.length > 80 || calls.has(callId)) return;
      if (!allowCall() || !(await mayCall(account, to))) return socket.emit("call:unavailable", { callId });
      calls.set(callId, { a: chatId, b: to, at: Date.now() });
      if (!relay("call:incoming", to, { sdp, callId })) {
        calls.delete(callId);
        socket.emit("call:unavailable", { callId });
      }
    });
    on("call:answer", ({ to, sdp, callId }) => {
      if (!peer(to, callId)) return;
      // Cavab verildi: zəngi qəbul edənin digər tablarında zəng səsini dayandır
      relay("call:answered", to, { sdp, callId });
      socketsOf(chatId).filter((id) => id !== socket.id).forEach((id) => io.to(id).emit("call:taken", { callId }));
    });
    on("call:ice", ({ to, candidate, callId }) => peer(to, callId) && relay("call:ice", to, { candidate, callId }));
    const endWith = (event) => ({ to, callId }) => {
      if (!peer(to, callId)) return;
      relay(event, to, { callId });
      calls.delete(callId);
    };
    on("call:reject", endWith("call:rejected"));
    on("call:end", endWith("call:ended"));

    socket.on("disconnect", () => {
      const sockets = onlineUsers.get(chatId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(chatId);
        announce(account, false).catch(() => {});
      }
    });
  });

  return io;
}

module.exports = { setupSocket, parseRoom, belongsToRoom, otherSide, resolveReceiver };
