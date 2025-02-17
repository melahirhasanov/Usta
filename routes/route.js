const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Users = require("../models/Users");
const router = express.Router();

// User Registration
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, phoneNumber } = req.body;
    
    console.log("Gelen req.body:", req.body); // Debug üçün request log

    // Daxil olan datanın düzgün formatda olub-olmadığını yoxla
    if (!username || !email || !password) {
      return res.status(400).json({ message: "Bütün sahələri doldurun!" });
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Email və ya şifrə düzgün formatda deyil!" });
    }

    // İstifadəçi mövcuddurmu?
    const userExist = await Users.findOne({ $or: [{ username }, { email }] });
    if (userExist) {
      return res.status(400).json({ message: "Username və ya email artıq mövcuddur!" });
    }

    // Şifrəni hash et

    // Yeni istifadəçi yarat
    const newUser = new Users({
      username,
      email,
      password,
      phoneNumber
    });

    await newUser.save();
    res.status(201).json({ message: "İstifadəçi uğurla qeydiyyatdan keçdi!" });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server xətası baş verdi!" });
  }
});

// User Login
router.post("/login", async (req, res) => {
  try {
    console.log("Gelen req.body:", req.body); // Debug üçün request log

    const { email, password} = req.body;

    // Əgər email və ya password göndərilməyibsə
    if (!email || !password) {
      return res.status(400).json({ message: "Email və şifrə tələb olunur!" });
    }

    // Əgər email və password string formatında deyilsə
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Email və ya şifrə düzgün formatda deyil!" });
    }

    // İstifadəçi bazada varmı?
    const user = await Users.findOne({ email });
    if (!user) {
      console.log("İstifadəçi tapılmadı!");
      return res.status(400).json({ message: "Daxil etdiyiniz məlumatlar yanlışdır!" });
    }

    console.log("Daxil edilən şifrə:", password);
    console.log("Hash edilmiş şifrə:", user.password);
    
    // Şifrə uyğunluğunu yoxlayın
    const isMatch = await bcrypt.compare(password, user.password);
    console.log("Şifrə uyğunluğu:", isMatch); // true or false
    if (!isMatch) {
      return res.status(400).json({ message: "Daxil etdiyiniz məlumatlar yanlışdır!" });
    }
    



    // JWT Token yarat
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
res.status(200).json({
  token,
  isAuthenticated:true,
  user:{
    id:user._id,
    username:user.username,
    email:user.email
  },
  message:"Giris Ugurlu oldu"
})
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message : "Server xətası baş verdi!" });
  }
});

module.exports = router;
