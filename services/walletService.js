// backend/services/walletService.js

const bcrypt = require('bcrypt');
const User = require('../models/User');
const { createWallet } = require('../wasm_rpc'); // Adjust the path as necessary

async function createNewWallet(username, password) {
  // Generate wallet using wasm_rpc.js
  const walletData = await createWallet();

  if (!walletData.success) {
    throw new Error(walletData.error || 'Failed to create wallet.');
  }

  const { walletAddress, xPrv, mnemonic } = walletData;

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Create and save the user
  const user = new User({
    username,
    walletAddress,
    passwordHash,
    xPrv,       // Storing xPrv directly
    mnemonic    // Storing mnemonic directly
  });

  await user.save();

  return { walletAddress };
}

module.exports = { createNewWallet };
