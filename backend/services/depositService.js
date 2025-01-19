// backend/services/depositService.js

const fetch = require('node-fetch');
const User = require('../models/User');

/**
 * Fetch KAS/KASPER deposits for a given wallet address.
 * @param {string} walletAddress
 * @returns {Array} Array of deposit transactions
 */
async function fetchKaspasDeposits(walletAddress) {
  try {
    // Define currencies to monitor
    const currencies = ['kas', 'kasper'];

    const deposits = [];

    for (const currency of currencies) {
      // Fetch transactions from Kaspa API
      const url = `https://api.kaspa.org/addresses/${encodeURIComponent(walletAddress)}/full-transactions-page?limit=100&fields=full`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Error fetching transactions for ${walletAddress}:`, response.statusText);
        continue;
      }

      const data = await response.json();

      for (const tx of data) {
        // Filter for incoming transfers
        if (tx.outputs) {
          for (const output of tx.outputs) {
            if (output.script_public_key_address.toLowerCase() === walletAddress.toLowerCase()) {
              deposits.push({
                hashRev: tx.transaction_id,
                amount: output.amount, // Assuming amount is in the smallest unit
                currency: currency
              });
            }
          }
        }
      }
    }

    return deposits;
  } catch (err) {
    console.error("Error fetching Kaspa deposits:", err);
    return [];
  }
}

/**
 * Check if a transaction has already been processed.
 * @param {string} hashRev
 * @param {string} walletAddress
 * @returns {boolean}
 */
async function isTransactionProcessed(hashRev, walletAddress) {
  // Check if any generatedFile has the requestId as hashRev
  const user = await User.findOne({ walletAddress, 'generatedFiles.requestId': hashRev });
  return !!user;
}

/**
 * Save a processed transaction to the user's generatedFiles to prevent reprocessing.
 * @param {string} hashRev
 * @param {number} amount
 * @param {string} currency
 * @param {string} walletAddress
 */
async function saveTransaction(hashRev, amount, currency, walletAddress) {
  // Add a generatedFile entry with the transaction hash
  const user = await User.findOne({ walletAddress });
  if (user) {
    user.generatedFiles.push({
      requestId: hashRev,
      content: `Deposit of ${amount} ${currency.toUpperCase()}`
    });
    await user.save();
  }
}

/**
 * Scan deposits and credit user accounts accordingly.
 * @param {string} walletAddress
 * @param {string} password
 * @returns {object} Result object with success status and credits added or error
 */
async function scanDeposits(walletAddress, password) {
  try {
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return { success: false, error: "Invalid wallet address or password." };
    }

    // Compare password
    const bcrypt = require('bcrypt');
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      return { success: false, error: "Invalid wallet address or password." };
    }

    // Fetch transactions from Kaspa API
    const newDeposits = await fetchKaspasDeposits(walletAddress);

    let creditsAdded = 0;

    for (const tx of newDeposits) {
      const { hashRev, amount, currency } = tx;

      // Check if transaction is already processed
      const isProcessed = await isTransactionProcessed(hashRev, walletAddress);
      if (!isProcessed) {
        // Convert amount to credits
        let credits = 0;
        if (currency.toLowerCase() === 'kas') {
          credits = Math.floor(amount / 5);
        } else if (currency.toLowerCase() === 'kasper') {
          credits = Math.floor(amount / 340);
        }

        if (credits > 0) {
          // Update user's credits
          user.credits += credits;
          creditsAdded += credits;

          // Save transaction as processed
          await saveTransaction(hashRev, amount, currency, walletAddress);
        }
      }
    }

    await user.save();

    return { success: true, creditsAdded };
  } catch (err) {
    console.error("Error scanning deposits:", err);
    return { success: false, error: "Internal server error." };
  }
}

module.exports = { scanDeposits };
