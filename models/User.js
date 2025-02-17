const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  googleId: { type: String, sparse: true }, // Google ID varsa saxlanır, yoxdursa, null ola bilər
  name: { type: String, required: true }, // Ad məcburidir
  email: { type: String, required: true, unique: true }, // Email unikal və məcburidir
  photo: { type: String } // Profil şəkli (olmasa da olar)
});

// Modeli yaradırıq
const User = mongoose.model("User", userSchema);

module.exports = User;
