// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const { createNewWallet } = require('../services/walletService');

router.post('/create-wallet', async (req, res) => {
  const { username, password } = req.body;

  try {
    const { walletAddress } = await createNewWallet(username, password);
    res.json({ success: true, walletAddress });
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
