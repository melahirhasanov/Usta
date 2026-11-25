const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, unique: false, default: undefined },
  password: { type: String },
  email: { 
    type: String, 
    unique: true, 
    match: [/\S+@\S+\.\S+/, "Please provide a valid email address"]
  },
  phoneNumber: { 
    type: Number,
    match: [/^\+?\d{10,15}$/, "Please provide a valid phone number"]
  },
  profileImage: { type: String },
  profileImageId: { type: String },
  isBlocked: { type: Boolean, default: false },
  passwordChangedAt: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date }
});

// Middleware to hash the password before saving
const bcrypt = require("bcryptjs");

userSchema.pre("save", async function (next) {

  // Generate username if it doesn't exist
  if (!this.username) {
    this.username = this.email.split("@")[0] + Math.floor(Math.random() * 1000);
  }

  // Hash password if it's modified
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  
  next();
});


const Users = mongoose.model("Users", userSchema);
module.exports = Users;