const express = require("express");
const bcrypt = require("bcryptjs");
const { findByEmail, checkLogin } = require("../services/login");
const jwt = require("jsonwebtoken");
const master = require("../models/Master");
const { CATEGORIES } = require("../config/constants");
const { checkCoords, checkEmail, checkName, checkPassword, checkPhone, firstError } = require("../middleware/validate");
const router = express.Router();

// User Registration
router.post("/registerUsta", async (req, res) => {
  try {
    const { name, email, password, phone, surname, city, category,latitude,longitude } = req.body;

    // Daxil olan datanın düzgün formatda olub-olmadığını yoxla
    if (!name || !email || !password || !phone || !surname || !city || !category || latitude == null || longitude == null) {
      return res.status(400).json({ message: "Bütün sahələri doldurun!" });
    }
    const invalid = firstError(
      checkName(name, "Ad"), checkName(surname, "Soyad"), checkEmail(email), checkPassword(password),
      checkPhone(phone), checkCoords(latitude, longitude),
      typeof city === "string" && city.length <= 50 ? null : "Şəhər düzgün deyil",
      CATEGORIES.includes(category) ? null : "İxtisas siyahıdan seçilməlidir"
    );
    if (invalid) return res.status(400).json({ message: invalid });

    // İstifadəçi mövcuddurmu?
    const userExist = (await findByEmail(master, email)) || (await master.exists({ phone: String(phone) }));
    if (userExist) {
      return res.status(400).json({ message: "Bu email və ya telefon artıq qeydiyyatdadır" });
    }

    // Şifrəni hash et
    const hashedPassword = await bcrypt.hash(password, 10);

    // Yeni istifadəçi yarat
    const newUser = new master({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      phone: String(phone),
      surname: surname.trim(),
      city,
      category,
      location:{
        type:"Point",
        coordinates:[parseFloat(longitude),parseFloat(latitude)]
      }
    });

    await newUser.save();
    res.status(201).json({ message: "İstifadəçi uğurla qeydiyyatdan keçdi!" });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server xətası baş verdi!" });
  }
});

// User Login
router.post("/loginUsta", async (req, res) => {
  try {

    const { email, password } = req.body;

    // Əgər email və ya password göndərilməyibsə
    if (!email || !password) {
      return res.status(400).json({ message: "Email və şifrə tələb olunur!" });
    }

    // Əgər email və password string formatında deyilsə
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Email və ya şifrə düzgün formatda deyil!" });
    }

    const user = await findByEmail(master, email);
    if (!(await checkLogin(user, password))) return res.status(400).json({ message: "Daxil etdiyiniz məlumatlar yanlışdır!" });
    if (user.isBlocked) return res.status(403).json({ message: "Hesabınız administrator tərəfindən bloklanıb" });

    // JWT Token yarat
    const token = jwt.sign({ id: user._id, role: "master" }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      token,
      isAuthenticated: true,
      user: {
        id: user._id,
        name: user.name,
        profileImage: user.profileImage,
        email: user.email,
        surname: user.surname,
        phone: user.phone,
        category:user.category,
        city:user.city,
        isAvailable:user.isAvailable !== false
      },
      message: "Giriş uğurlu oldu",
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server xətası baş verdi!" });
  }
});

module.exports = router;
