const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const Master = require("../models/Master");
const Users = require("../models/User");
const { requireAuth, requireRole } = require("../middleware/auth");
const { rateLimit } = require("../middleware/security");

// Profil şəkli: usta və müştəri üçün eyni endpoint. Cloudinary açarları routes/post.js-də konfiqurasiya olunur.
const router = express.Router();
const MAX_MB = 5;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

// Brauzerin dediyi tipə yox, faylın öz baytlarına baxılır (JPG, PNG, WEBP)
const isImage = (b) =>
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
  b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
  (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP");

const modelFor = (req) => (req.account.role === "master" ? Master : Users);
const destroy = (id) =>
  id ? cloudinary.uploader.destroy(id, { invalidate: true }).catch((e) => console.warn("Köhnə profil şəkli silinmədi:", e.message)) : null;

const uploadBuffer = (buffer) =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: "profile_photos",
          resource_type: "image",
          // Kvadrat 400x400; format çevrilməsi EXIF/GPS məlumatını da silir
          transformation: [{ width: 400, height: 400, crop: "fill", gravity: "auto" }],
          format: "jpg",
        },
        (err, result) => (err ? reject(err) : resolve(result))
      )
      .end(buffer);
  });

router.use(requireAuth, requireRole("master", "customer"));

router.put(
  "/",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => `${req.account.id}|photo`, message: "Çox tez-tez dəyişirsiniz, bir az sonra yoxlayın" }),
  (req, res, next) =>
    upload.single("photo")(req, res, (err) => {
      if (!err) return next();
      res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? `Şəkil ${MAX_MB} MB-dan böyük olmamalıdır` : "Şəkil yüklənmədi" });
    }),
  async (req, res) => {
    if (!req.file || !isImage(req.file.buffer)) return res.status(400).json({ message: "JPG, PNG və ya WEBP şəkil seçin" });
    if (!process.env.CLOUDINARY_API_SECRET) return res.status(503).json({ message: "Şəkil yükləmə hazırda işləmir (server konfiqurasiyası)" });
    try {
      const photo = await uploadBuffer(req.file.buffer);
      const old = await modelFor(req).findByIdAndUpdate(req.userId, { profileImage: photo.secure_url, profileImageId: photo.public_id }).select("profileImageId");
      await destroy(old?.profileImageId);
      res.json({ profileImage: photo.secure_url });
    } catch (error) {
      console.error("Profil şəkli xətası:", error.message);
      res.status(502).json({ message: "Şəkil yüklənmədi, bir az sonra yenidən cəhd edin" });
    }
  }
);

router.delete("/", async (req, res) => {
  try {
    const old = await modelFor(req).findByIdAndUpdate(req.userId, { $unset: { profileImage: 1, profileImageId: 1 } }).select("profileImageId");
    await destroy(old?.profileImageId);
    res.json({ profileImage: null });
  } catch (error) {
    console.error("Profil şəkli silinmədi:", error.message);
    res.status(500).json({ message: "Şəkil silinmədi" });
  }
});

module.exports = router;
