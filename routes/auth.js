// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const { createWallet } = require('../wasm_rpc'); // Adjust the path as necessary
const bcrypt = require('bcrypt');
const User = require('../models/User');

// POST /create-wallet
router.post('/create-wallet', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    // Create wallet using wasm_rpc.js
    const walletData = await createWallet();

    if (!walletData.success) {
      return res.status(500).json({ success: false, error: walletData.error || "Failed to create wallet." });
    }

    const { xPrv, mnemonic, receivingAddress, changeAddress } = walletData;

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create and save the user
    const user = new User({
      username,
      walletAddress: receivingAddress, // Assuming receivingAddress is the primary wallet address
      passwordHash,
      xPrv,          // Store xPrv directly
      mnemonic,      // Store mnemonic directly
      credits: 0     // Initialize credits to 0
      // generatedFiles: [] // Initialized by default
    });

    await user.save();

    res.json({ success: true, walletAddress: receivingAddress });
  } catch (err) {
    console.error('Error creating wallet:', err);
    // Handle validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, error: errors.join(', ') });
    }
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

module.exports = router;
