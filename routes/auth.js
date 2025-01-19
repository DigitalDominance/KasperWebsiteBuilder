// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const { createNewWallet, getUserWalletDetails } = require('../services/walletService');

// POST /create-wallet
router.post('/create-wallet', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  const result = await createNewWallet(username, password);
  return res.json(result);
});

// POST /connect-wallet
router.post('/connect-wallet', async (req, res) => {
  const { walletAddress, password } = req.body;

  if (!walletAddress || !password) {
    return res.status(400).json({ success: false, error: "Wallet address and password are required." });
  }

  const result = await getUserWalletDetails(walletAddress, password);
  return res.json(result);
});

module.exports = router;
