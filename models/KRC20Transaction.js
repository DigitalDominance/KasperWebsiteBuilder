// backend/models/KRC20Transaction.js

const mongoose = require('mongoose');

const krc20TransactionSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },      // Associated wallet address
  hashRev: { type: String, required: true, unique: true }, // Unique transaction hashRev
  amount: { type: Number, required: true },            // Amount in KAS
  opType: { type: String, required: true },            // Operation type, e.g., 'transfer'
  toAddress: { type: String, required: true },         // Recipient address
  processedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('KRC20Transaction', krc20TransactionSchema);
