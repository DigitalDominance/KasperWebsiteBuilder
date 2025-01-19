// backend/models/User.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  walletAddress: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  xPrv: { type: String, required: true }, // Directly storing xPrv
  mnemonic: { type: String, required: true }, // Directly storing mnemonic
  credits: { type: Number, default: 0 },
  generatedFiles: [
    {
      requestId: { type: String, required: true },
      content: { type: String, required: true }
    }
  ]
});

module.exports = mongoose.model('User', userSchema);
