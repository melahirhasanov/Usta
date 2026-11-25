const express = require("express");
const router = express.Router();
const multer = require("multer");
const mongoose = require("mongoose");
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Post = require("../models/Post");
const Master = require("../models/Master");
const { requireAuth } = require("../middleware/auth");

// Açarlar .env faylındadır (heç vaxt koda yazmayın)
const CLOUDINARY_READY = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].every((k) => process.env[k]);
if (!CLOUDINARY_READY) console.warn("⚠️  Cloudinary açarları təyin edilməyib — şəkil/video yükləmə işləməyəcək");
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const MAX_SIZE_MB = 50; // Cloudinary pulsuz planında video limiti 100 MB-dır
const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|webm|x-msvideo))$/;

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder: "usta_posts",
    resource_type: file.mimetype.startsWith("video/") ? "video" : "image",
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    ALLOWED_MIME.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error("BAD_TYPE"), { code: "BAD_TYPE" })),
});

// Multer/Cloudinary xətalarını istifadəçiyə aydın mesaj kimi qaytarır
function uploadMedia(req, res, next) {
  if (!CLOUDINARY_READY) return res.status(503).json({ success: false, message: "Media yükləmə hazırda işləmir (server konfiqurasiyası)" });
  upload.single("media")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, message: `Fayl çox böyükdür (ən çox ${MAX_SIZE_MB} MB)` });
    if (err.code === "BAD_TYPE") return res.status(400).json({ success: false, message: "Yalnız JPG, PNG, GIF, WEBP şəkil və ya MP4, MOV, WEBM video yükləyə bilərsiniz" });
    console.error("Media yükləmə xətası:", err.message || err);
    res.status(502).json({ success: false, message: "Fayl yüklənmədi, bir az sonra yenidən cəhd edin" });
  });
}

const destroyMedia = (post) =>
  post.cloudinaryPublicId
    ? cloudinary.uploader.destroy(post.cloudinaryPublicId, { resource_type: post.mediaType === "video" ? "video" : "image", invalidate: true }).catch((e) => console.warn("Cloudinary silmə xətası:", e.message))
    : Promise.resolve();

// Post yaratmaq — yalnız usta, öz adına
router.post("/post", requireAuth, uploadMedia, async (req, res) => {
  const file = req.file;
  try {
    const title = typeof req.body.title === "string" ? req.body.title.trim().slice(0, 120) : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 2000) : "";
    if (!file) return res.status(400).json({ success: false, message: "Şəkil və ya video seçin" });
    if (!title || !description) {
      await destroyMedia({ cloudinaryPublicId: file.filename, mediaType: file.mimetype.startsWith("video/") ? "video" : "image" });
      return res.status(400).json({ success: false, message: "Başlıq və təsviri doldurun" });
    }

    const usta = await Master.findById(req.userId);
    if (!usta) {
      await destroyMedia({ cloudinaryPublicId: file.filename, mediaType: file.mimetype.startsWith("video/") ? "video" : "image" });
      return res.status(403).json({ success: false, message: "Yalnız ustalar paylaşım edə bilər" });
    }

    const newPost = await Post.create({
      user: usta._id,
      media: file.path, // Cloudinary https URL
      mediaType: file.mimetype.startsWith("video/") ? "video" : "image",
      cloudinaryPublicId: file.filename,
      description,
      title,
    });
    await Master.updateOne({ _id: usta._id }, { $push: { posts: newPost._id } });

    res.status(201).json({ success: true, message: "Paylaşım əlavə edildi", data: { postId: newPost._id, mediaUrl: newPost.media, title } });
  } catch (error) {
    console.error("Post yaratma xətası:", error.message);
    res.status(500).json({ success: false, message: "Server xətası" });
  }
});

// ✅ GET Postları almaq
router.get("/post", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (typeof userId !== "string" || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "User ID tələb olunur"
      });
    }

    const posts = await Post.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate('user', 'name profileImage');

    res.json({
      success: true,
      count: posts.length,
      data: posts
    });

  } catch (error) {
    console.error("GET Xətası:", error);
    res.status(500).json({
      success: false,
      message: "Server Xətası"
    });
  }
});

// ✅ Postu sil (yalnız sahibi)
router.delete("/:postId", requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(404).json({ success: false, message: "Post tapılmadı" });
    }
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post tapılmadı" });
    if (post.user.toString() !== req.userId) {
      return res.status(403).json({ success: false, message: "Bu postu silməyə icazəniz yoxdur" });
    }
    await post.deleteOne();
    await Master.updateOne({ _id: req.userId }, { $pull: { posts: post._id } });
    await destroyMedia(post); // faylı Cloudinary-dən də sil
    res.json({ success: true });
  } catch (error) {
    console.error("Post silmə xətası:", error);
    res.status(500).json({ success: false, message: "Server Xətası" });
  }
});

// ✅ Postu bəyən / bəyənməni geri al (toggle)
router.post("/:postId/like", requireAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.userId; // bəyənən həmişə daxil olmuş istifadəçidir

    if (!userId || !mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ success: false, message: "Düzgün postId və userId tələb olunur" });
    }

    const post = await Post.findById(postId).select("likes");
    if (!post) {
      return res.status(404).json({ success: false, message: "Post tapılmadı" });
    }

    const alreadyLiked = post.likes.some(id => id.toString() === userId);
    const update = alreadyLiked ? { $pull: { likes: userId } } : { $addToSet: { likes: userId } };
    const updated = await Post.findByIdAndUpdate(postId, update, { new: true }).select("likes");

    res.json({ success: true, liked: !alreadyLiked, likesCount: updated.likes.length });
  } catch (error) {
    console.error("Like Xətası:", error);
    res.status(500).json({ success: false, message: "Server Xətası" });
  }
});

module.exports = router;