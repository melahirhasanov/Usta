const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: String, // Email və ya 'anonim'
    required: true
  },
  senderName: {
    type: String,
    required: true
  },
  receiverId: {
    // Usta ID-si (müştəri yazanda) və ya müştəri emaili (usta cavab verəndə)
    type: String,
    required: true
  },
  receiverName: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isRead: {
    type: Boolean,
    default: false
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file'],
    default: 'text'
  }
}, {
  timestamps: true
});

// Otaq ID və tarix əsasında index
messageSchema.index({ roomId: 1, createdAt: -1 });

// Göndərən ID və oxunma statusu əsasında index
messageSchema.index({ senderId: 1, isRead: 1 });

// Qəbuledən ID əsasında index
messageSchema.index({ receiverId: 1 });

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;