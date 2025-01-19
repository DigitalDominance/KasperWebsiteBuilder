// backend/models/Transaction.js

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true },      // Associated wallet address
  transactionId: { type: String, required: true, unique: true }, // Unique transaction ID
  hash: { type: String },
  mass: { type: String },
  payload: { type: String },
  blockHash: [{ type: String }],
  blockTime: { type: Number },
  isAccepted: { type: Boolean },
  acceptingBlockHash: { type: String },
  acceptingBlockBlueScore: { type: Number },
  inputs: [
    {
      transactionId: { type: String },
      index: { type: Number },
      previousOutpointHash: { type: String },
      previousOutpointIndex: { type: String },
      previousOutpointResolved: {
        transactionId: { type: String },
        index: { type: Number },
        amount: { type: Number },
        scriptPublicKey: { type: String },
        scriptPublicKeyAddress: { type: String },
        scriptPublicKeyType: { type: String },
        acceptingBlockHash: { type: String }
      },
      previousOutpointAddress: { type: String },
      previousOutpointAmount: { type: Number },
      signatureScript: { type: String },
      sigOpCount: { type: String }
    }
  ],
  outputs: [
    {
      transactionId: { type: String },
      index: { type: Number },
      amount: { type: Number },
      scriptPublicKey: { type: String },
      scriptPublicKeyAddress: { type: String },
      scriptPublicKeyType: { type: String },
      acceptingBlockHash: { type: String }
    }
  ],
  fetchedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
