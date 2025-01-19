// backend/services/kasperDepositService.js

const axios = require('axios');
const KRC20Transaction = require('../models/KRC20Transaction');
const User = require('../models/User');

/**
 * Fetch KRC20 transactions for a given Kasper wallet address using the Kasper API.
 * @param {String} walletAddress - The Kasper wallet address.
 */
async function fetchKasperKRC20Transactions(walletAddress) {
  const url = `https://api.kasplex.org/v1/krc20/oplist`;
  const params = {
    address: walletAddress,
    tick: 'KASPER'
  };

  try {
    const response = await axios.get(url, { params });
    const data = response.data;

    if (data.message !== 'successful') {
      console.error(`Unexpected Kasper API response for ${walletAddress}:`, data);
      return;
    }

    const transactions = data.result;

    for (const tx of transactions) {
      const { hashRev, amt, op, to } = tx;

      // Only process 'transfer' operations to the correct address
      if (op.toLowerCase() !== 'transfer' || to !== walletAddress) {
        continue;
      }

      // Check if transaction already exists
      const exists = await KRC20Transaction.findOne({ hashRev });
      if (exists) continue;

      const amount = parseInt(amt, 10) / 1e8; // Convert from sompi to KAS

      // Save transaction to database
      const newTx = new KRC20Transaction({
        walletAddress,
        hashRev,
        amount,
        opType: op,
        toAddress: to
      });

      await newTx.save();

      // Update user's credits
      await User.updateOne(
        { walletAddress },
        { $inc: { credits: amount } }
      );

      console.log(`Processed Kasper KRC20 transaction: ${hashRev}, Amount: ${amount} KAS`);
    }

  } catch (error) {
    console.error(`Error fetching Kasper KRC20 transactions for ${walletAddress}:`, error.message);
  }
}

/**
 * Process all users and fetch their Kasper KRC20 transactions.
 */
async function processKasperDeposits() {
  try {
    const users = await User.find({});

    for (const user of users) {
      console.log(`Fetching Kasper KRC20 transactions for wallet: ${user.walletAddress}`);
      await fetchKasperKRC20Transactions(user.walletAddress);
    }

    console.log('Kasper KRC20 deposit processing completed.');
  } catch (error) {
    console.error('Error processing Kasper deposits:', error.message);
  }
}

module.exports = { processKasperDeposits };
