// backend/routes/deposits.js

const express = require('express');
const router = express.Router();
const { scanDeposits } = require('../services/depositService');

// POST /scan-deposits
// Body:
// {
//   walletAddress: "UserWalletAddress",
//   password: "UserPassword"
// }
router.post('/scan-deposits', async (req, res) => {
  const { walletAddress, password } = req.body;

  if (!walletAddress || !password) {
    return res.status(400).json({ success: false, error: "Wallet address and password are required." });
  }

  const result = await scanDeposits(walletAddress, password);
  return res.json(result);
});

module.exports = router;
