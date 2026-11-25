const mongoose = require("mongoose");

// Admin əməliyyatlarının jurnalı: kim, nə vaxt, nə etdi. Paneldən silinmir və dəyişdirilmir.
const schema = new mongoose.Schema(
  {
    admin: { id: String, name: String },
    action: { type: String, required: true },
    target: { type: String },
    details: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "elustu_adminlogs" }
);
module.exports = mongoose.model("AdminLog", schema);
