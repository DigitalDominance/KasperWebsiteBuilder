// backend/models/User.js

const mongoose = require('mongoose');

const GeneratedFileSchema = new mongoose.Schema({
  requestId: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
  content: { type: String, required: true }
});

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  walletAddress: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  mnemonicEncrypted: { type: String, required: true },
  xPrvEncrypted: { type: String, required: true },
  generatedFiles: [GeneratedFileSchema],
  credits: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
