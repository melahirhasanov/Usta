const express = require("express");
const router = express.Router();
const multer = require("multer");
const mongoose = require("mongoose");
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Post = require("../models/Post");
const Master = require("../models/master");
const { requireAuth } = require("../middleware/auth");

// Açarlar .env faylındadır (heç vaxt koda yazmayın)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Cloudinary Storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'usta_posts',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'avi'],
    resource_type: 'auto'
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// ✅ POST Yaratmaq
router.post("/post", requireAuth, upload.single("media"), async (req, res) => {
  try {
    // Post həmişə daxil olmuş ustanın adına yaradılır
    const user = req.userId;
    const { description, title } = req.body;
    
    // Validasiya
    if (!description || !title) {
      return res.status(400).json({ 
        success: false,
        message: "Bütün Məlumatları Doldurun" 
      });
    }

    // Cloudinary URL
    const ImageUrl = req.file ? req.file.path : null;
    
    if (!ImageUrl) {
      return res.status(400).json({ 
        success: false,
        message: "Media Faylı Yüklənmədi" 
      });
    }

    // Ustanı tap
    const usta = await Master.findById(user);
    if (!usta) {
      return res.status(404).json({ 
        success: false,
        message: "Usta Tapılmadı" 
      });
    }

    // Yeni post yarat
    const newPost = new Post({
      user,
      media: ImageUrl,
      description,
      title
    });

    await newPost.save();

    // Ustanın postlarına əlavə et
    usta.posts = usta.posts || [];
    usta.posts.push(newPost._id);
    await usta.save();

    // Uğurlu cavab
    res.status(201).json({
      success: true,
      message: "Postunuz Uğurla Göndərildi",
      data: {
        postId: newPost._id,
        mediaUrl: ImageUrl,
        title: title
      }
    });

  } catch (error) {
    console.error("❌ POST XƏTASI:", error);
    res.status(500).json({
      success: false,
      message: "Server Xətası",
      error: error.message
    });
  }
});

// ✅ GET Postları almaq
router.get("/post", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
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