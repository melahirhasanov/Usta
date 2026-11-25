require("dotenv").config();
const fs = require("fs");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const cors = require("cors");
const { setupSocket } = require("./socket");
const { sanitize, limits } = require("./middleware/security");
const { FRONTEND_URL, DEFAULT_FRONTEND_URL } = require("./config/constants");

// Zəruri mühit dəyişənləri olmadan server açılmır (zəif/boş açarla işləməsin)
for (const name of ["JWT_SECRET", "DB_URL"]) {
  if (!process.env[name]) {
    console.error(`${name} .env faylında təyin edilməyib`);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET ən azı 32 simvol olmalıdır");
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === "production";
// FRONTEND_URL: bir və ya vergüllə ayrılmış bir neçə ünvan; sondakı "/" nəzərə alınmır
const normalizeOrigin = (url) => url.trim().replace(/\/+$/, "");
const allowedOrigins = [
  // Lokal ünvanlar yalnız inkişaf mühitində
  ...(isProd ? [] : ["http://localhost:5173", "http://localhost:3000"]),
  // Render-dəki FRONTEND_URL köhnə qalsa belə, standart (yayımlanmış) ünvan da həmişə icazəlidir
  ...new Set([FRONTEND_URL, DEFAULT_FRONTEND_URL, ...(process.env.FRONTEND_URL || "").split(",")].filter((u) => u.trim()).map(normalizeOrigin)),
];

app.set("trust proxy", 1); // reverse proxy (nginx) arxasında real IP — sorğu limiti üçün
app.use(
  helmet({
    // Şəkillər/videolar frontend domenindən yüklənir
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(sanitize);
app.use(
  cors({
    // İcazəsiz mənbədən gələn sorğuya CORS başlığı verilmir (brauzer bloklayır); server xətası (500) qaytarılmır
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(normalizeOrigin(origin))),
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use("/api", limits.api);
// Şəxsi məlumat brauzer və proxy keşində qalmasın
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Köhnə lokal yükləmələr (yeni paylaşımlar Cloudinary-dədir)
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
app.use("/uploads", express.static("uploads", { dotfiles: "deny", index: false }));

// Brute-force-a qarşı: giriş, qeydiyyat və şifrə bərpası
app.use(["/api/auth/login", "/api/auth/loginUsta", "/api/auth/register", "/api/auth/registerUsta", "/api/admin/login"], limits.auth);
app.use(["/api/auth/login", "/api/auth/loginUsta", "/api/admin/login"], limits.account);
app.post(["/api/orders", "/api/complaints"], limits.create);
app.use(["/api/auth/forgot-password", "/api/auth/reset-password"], limits.passwordReset);

// Yeni qeydiyyat admin paneldən dayandırıla bilər
const { getSettings } = require("./models/SiteSettings");
app.use(["/api/auth/register", "/api/auth/registerUsta"], (req, res, next) =>
  getSettings().then((s) => (s.registrationEnabled ? next() : res.status(503).json({ message: "Qeydiyyat müvəqqəti dayandırılıb" })), next));
app.get("/api/settings", (req, res, next) =>
  getSettings().then((s) => res.json({ announcement: s.announcementActive ? s.announcement : "", registrationEnabled: s.registrationEnabled, ordersEnabled: s.ordersEnabled }), next));

// API
app.use("/api/auth", require("./routes/customerAuth"));
app.use("/api/auth", require("./routes/masterAuth"));
app.use("/api/auth", require("./routes/passwordReset"));
app.use("/api/master", require("./routes/masters"));
app.use("/api/post", require("./routes/posts"));
app.use("/api/profile/photo", require("./routes/profilePhoto"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/complaints", require("./routes/complaints"));
app.use("/api/routing", limits.routing, require("./routes/routing"));
app.use("/api/admin", require("./routes/admin"));

// Onlayn nişanı: hamıya yalnız ustaların ID-si; müştəri email-ləri heç vaxt ictimai qaytarılmır.
// Daxil olmuş usta yalnız özü ilə yazışan müştəriləri görür (socket "presence" hadisəsi ilə).
app.get("/api/online-users", (req, res) => {
  res.json({ success: true, ids: app.get("onlineMasterIds")?.() || [] });
});

app.get("/", (req, res) => res.json({ name: "Əlüstü API", status: "ok" }));

app.use("/api", (req, res) => res.status(404).json({ message: "Endpoint tapılmadı" }));

// Gözlənilməz xətalar: 5xx-də daxili detalı istifadəçiyə göstərmə
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error("Server xətası:", err);
  if (err.type === "entity.too.large") return res.status(413).json({ message: "Sorğu çox böyükdür" });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ message: "Fayl 50 MB-dan böyük olmamalıdır" });
  res.status(status).json({ message: status >= 500 && isProd ? "Server xətası" : err.message || "Server xətası" });
});

mongoose
  .connect(process.env.DB_URL)
  .then(() => console.log("MongoDB bağlantısı uğurludur!"))
  .catch((error) => console.error("MongoDB bağlantısı uğursuz oldu!", error.message));

const server = http.createServer(app);
setupSocket(server, app, allowedOrigins);

// Gözlənilməz xəta bütün istifadəçiləri dayandırmasın
process.on("unhandledRejection", (e) => console.error("Tutulmamış xəta:", e?.message || e));

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`İcazəli frontend ünvanları: ${allowedOrigins.join(", ")}`);
});
