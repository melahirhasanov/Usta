const mongoose = require("mongoose");

const REASONS = ["no_show", "quality", "price", "behavior", "fraud", "other"];
const STATUSES = ["open", "in_review", "resolved", "rejected"];

const complaintSchema = new mongoose.Schema(
  {
    reporter: {
      role: { type: String, enum: ["customer", "master"], required: true },
      id: { type: String, required: true },
      name: { type: String, required: true },
      email: { type: String },
    },
    target: {
      type: { type: String, enum: ["master", "customer"], required: true },
      id: { type: String, required: true }, // usta üçün ID, müştəri üçün Users ID
      name: { type: String, required: true },
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    reason: { type: String, enum: REASONS, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1500 },
    status: { type: String, enum: STATUSES, default: "open", index: true },
    adminNote: { type: String, trim: true, maxlength: 1000 },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

complaintSchema.statics.REASONS = REASONS;
complaintSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Complaint", complaintSchema);
