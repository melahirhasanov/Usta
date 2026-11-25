const mongoose = require("mongoose");

const postSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Master",
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  media: {
    type: String,
    required: true
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  views: {
    type: Number,
    default: 0
  },
  isDemo: { type: Boolean, default: false },
  cloudinaryPublicId: {
    type: String // Cloudinary ID saxlamaq üçün
  }
}, {
  timestamps: true
});

// Postu yaratdıqda mediaType-i avtomatik təyin et
postSchema.pre('save', function(next) {
  if (this.media) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
    const videoExtensions = ['.mp4', '.mov', '.avi'];
    
    const isImage = imageExtensions.some(ext => this.media.toLowerCase().includes(ext));
    const isVideo = videoExtensions.some(ext => this.media.toLowerCase().includes(ext));
    
    if (isImage) this.mediaType = 'image';
    if (isVideo) this.mediaType = 'video';
  }
  next();
});

const Post = mongoose.model("Post", postSchema);
module.exports = Post;