// İstifadə: npm run create-admin -- admin@example.com GüclüŞifrə123 "Ad Soyad"
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("../models/Admin");

(async () => {
  const [email, password, name = "Administrator"] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error('İstifadə: npm run create-admin -- <email> <şifrə (ən azı 10 simvol)> "<Ad>"');
    process.exit(1);
  }
  await mongoose.connect(process.env.DB_URL);
  const hash = await bcrypt.hash(password, 12);
  await Admin.findOneAndUpdate({ email }, { email, name, password: hash }, { upsert: true });
  console.log(`Admin hazırdır: ${email}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
