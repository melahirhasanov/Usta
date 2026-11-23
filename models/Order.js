const mongoose = require("mongoose");

const STATUSES = ["pending", "accepted", "rejected", "on_the_way", "in_progress", "completed", "cancelled"];

const orderSchema = new mongoose.Schema(
  {
    customer: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Users", required: true, index: true },
      email: { type: String, required: true }, // chat/zəng ID-si
      name: { type: String, required: true },
    },
    master: { type: mongoose.Schema.Types.ObjectId, ref: "Master", required: true, index: true },
    category: { type: String, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    address: { type: String, required: true, trim: true, maxlength: 200 },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] }, // [lng, lat]
    },
    scheduledAt: { type: Date },
    // Usta yolda olanda son məlum yeri (socket ilə yenilənir, müştəri xəritədə izləyir)
    tracking: {
      lat: { type: Number },
      lng: { type: Number },
      at: { type: Date },
    },
    price: { type: Number, min: 0 },
    masterNote: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    history: [
      {
        status: { type: String, enum: STATUSES },
        by: { type: String, enum: ["customer", "master", "admin"] },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    review: {
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, trim: true, maxlength: 500 },
      createdAt: { type: Date },
    },
  },
  { timestamps: true }
);

orderSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Order", orderSchema);
