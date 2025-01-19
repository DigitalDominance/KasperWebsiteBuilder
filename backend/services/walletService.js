// backend/services/walletService.js

const { createWallet } = require('../wasm_rpc');
const User = require('../models/User');
const bcrypt = require('bcrypt');

/**
 * Creates a new wallet and stores user details.
 * @param {string} username 
 * @param {string} password 
 * @returns {object} Result object with success status and wallet address or error
 */
async function createNewWallet(username, password) {
  try {
    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return { success: false, error: "Username already exists." };
    }

    // Create wallet using wasm_rpc.js
    const walletData = await createWallet();

    if (!walletData.success) {
      return { success: false, error: "Wallet creation failed." };
    }

    const { mnemonic, receivingAddress, xPrv } = walletData;

    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const newUser = new User({
      username,
      walletAddress: receivingAddress,
      passwordHash,
      mnemonic,
      xPrv,
      generatedFiles: [],
      credits: 0
    });

    await newUser.save();

    return { success: true, walletAddress: receivingAddress };
  } catch (err) {
    console.error("Error creating wallet:", err);
    return { success: false, error: "Internal server error." };
  }
}

/**
 * Retrieves a user's wallet details.
 * @param {string} walletAddress 
 * @param {string} password 
 * @returns {object} Result object with wallet details or error
 */
async function getUserWalletDetails(walletAddress, password) {
  try {
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return { success: false, error: "User not found." };
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return { success: false, error: "Invalid password." };
    }

    // Return wallet details
    return {
      success: true,
      username: user.username,
      walletAddress: user.walletAddress,
      mnemonic: user.mnemonic,
      xPrv: user.xPrv,
      credits: user.credits,
      generatedFiles: user.generatedFiles
    };
  } catch (err) {
    console.error("Error retrieving wallet details:", err);
    return { success: false, error: "Internal server error." };
  }
}

module.exports = { createNewWallet, getUserWalletDetails };
