const mongoose = require("mongoose");

// Admin hesabları yalnız skriptlə yaradılır: npm run create-admin -- <email> <şifrə> "<Ad>"
const adminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", adminSchema);
