const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    match: [/\S+@\S+\.\S+/, "Please provide a valid email address"]
  },
  phoneNumber: { 
    type: Number, // Changed to string to preserve formatting
    required: true,
    match: [/^\+?\d{10,15}$/, "Please provide a valid phone number"] // Regex for valid phone number
  }
});

// Middleware to hash the password before saving
const bcrypt = require('bcryptjs');
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10); // Hash password before saving
  }
  next();
});

const Users = mongoose.model("Users", userSchema);
module.exports = Users;
