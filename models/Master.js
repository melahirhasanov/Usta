const mongoose = require("mongoose")

const masterSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    surname: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, required: true, unique: true },
    city: { type: String, required: true },
    category: { type: String, required: true },
    password: { type: String, required: true },
    bio: { type: String, trim: true, maxlength: 600, default: "" },
    experience: { type: Number, min: 0, max: 70, default: 0 },
    // Profil şəkli (Cloudinary)
    profileImage: { type: String },
    profileImageId: { type: String },
    // Nümunə profil (scripts/seedDemo.js): real adam deyil, sifariş və mesaj qəbul etmir
    isDemo: { type: Boolean, default: false, index: true },
    // Tamamlanmış sifarişlərin rəylərindən hesablanır (routes/orders.js)
    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 },
    // Usta özü "sifariş qəbul edirəm" rejimini açıb-bağlayır; söndürülübsə xəritədə görünmür
    isAvailable: { type: Boolean, default: true },
    // Admin tərəfindən bloklanmış usta heç yerdə görünmür və daxil ola bilmir
    isBlocked: { type: Boolean, default: false },
    location: {
        type: { type: String, enum: ["Point"], required: true, default: "Point" },
        coordinates: { type: [Number], required: true }
    },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Master" }],
    posts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Post" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "Master" }],
    passwordChangedAt: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
}, { timestamps: true })

masterSchema.index({ location: "2dsphere" })

const master = mongoose.model("Master", masterSchema)
module.exports = master
