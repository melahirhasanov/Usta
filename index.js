const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const passport = require("passport");
const session = require("express-session");
const router = require("./routes/productRoute");
const AuthRouter = require("./routes/route");

require("./auth");// Passport konfiqurasiyası

const app = express();

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cats", // Make this dynamic for production
    resave: false,
    saveUninitialized: true,
  })
);
app.use(express.json());
// CORS Configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ["GET", "POST"],
  credentials: true
}));

// Middleware
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", AuthRouter);
app.use("/api/products", router);

// Define the isLoggedIn function
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    return next();  // Proceed to the next middleware (i.e., the route handler)
  } else {
    return res.status(401).json({ message: "Unauthorized access" });  // Send 401 if not authenticated
  }
}

// Protected route
app.get("/protected", isLoggedIn, (req, res) => {
  res.send(`Salamun Aleykum ${req.user.name}! Email: ${req.user.email}`);
});

// MongoDB Connection
mongoose.connect(process.env.DB_URL)
  .then(() => {
    console.log("MongoDB bağlantısı uğurludur!");
  })
  .catch((err) => {
    console.error("MongoDB bağlantısı uğursuz oldu!", err);
  });

// Passport authentication routes
app.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));
app.get("/auth/github", passport.authenticate("github", { scope: ["email", "profile"] }));

// Handle OAuth callbacks
app.get("/google/callback", passport.authenticate("google", {
  successRedirect: process.env.FRONTEND_URL || "http://localhost:5173/",
  failureRedirect: "/auth/failure",
}));
app.get("/github/callback", passport.authenticate("github", {
  successRedirect: process.env.FRONTEND_URL || "http://localhost:5173/",
  failureRedirect: "/auth/failure",
}));

// Simple login options route
app.get("/", (req, res) => {
  res.send('<a href="/auth/github">Github ilə Giriş</a><br><a href="/auth/google">Google ilə Giriş</a>');
});

// Logout
app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Failure route
app.get("/auth/failure", (req, res) => {
  res.send("Giriş uğursuz oldu!");
});

// Create HTTP server
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true
  }
});

io.on("connection", (socket) => {
  console.log(`Yeni istifadəçi qoşuldu: ${socket.id}`);
  socket.on("send_message", (data) => {
    console.log("Mesaj alındı:", data);
    io.emit("receive_message", data);
  });
  socket.on("disconnect", () => {
    console.log(`İstifadəçi ayrıldı: ${socket.id}`);
  });
});

// Start server
server.listen(process.env.PORT, () => {
  console.log(`Server is running at http://localhost:${process.env.PORT}`);
});
