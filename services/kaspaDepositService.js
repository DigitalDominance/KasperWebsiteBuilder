// backend/services/kaspaDepositService.js

const axios = require('axios');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

/**
 * Fetch transactions for a given Kaspa address using the Kaspa REST API.
 * @param {String} walletAddress - The Kaspa wallet address.
 */
async function fetchKaspaTransactions(walletAddress) {
  const limit = 50; // Adjust as needed
  let before = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const url = `https://api.kaspa.org/addresses/${walletAddress}/full-transactions-page`;
      const params = {
        limit,
        before,
        resolve_previous_outpoints: 'full' // 'no', 'light', or 'full'
      };

      const response = await axios.get(url, { params });

      const transactions = response.data;

      if (transactions.length === 0) {
        hasMore = false;
        break;
      }

      for (const tx of transactions) {
        // Check if transaction already exists
        const exists = await Transaction.findOne({ transactionId: tx.transaction_id });
        if (exists) continue;

        // Create new transaction entry
        const newTx = new Transaction({
          walletAddress,
          transactionId: tx.transaction_id,
          hash: tx.hash,
          mass: tx.mass,
          payload: tx.payload,
          blockHash: tx.block_hash,
          blockTime: tx.block_time,
          isAccepted: tx.is_accepted,
          acceptingBlockHash: tx.accepting_block_hash,
          acceptingBlockBlueScore: tx.accepting_block_blue_score,
          inputs: tx.inputs,
          outputs: tx.outputs
        });

        await newTx.save();
      }

      // Prepare for next page
      before = transactions[transactions.length - 1].block_time;

      // If fewer transactions than limit, no more pages
      if (transactions.length < limit) {
        hasMore = false;
      }
    } catch (error) {
      console.error(`Error fetching Kaspa transactions for ${walletAddress}:`, error.message);
      hasMore = false;
    }
  }
}

/**
 * Process all users and fetch their Kaspa transactions.
 */
async function processKaspaDeposits() {
  try {
    const users = await User.find({});

    for (const user of users) {
      console.log(`Fetching Kaspa transactions for wallet: ${user.walletAddress}`);
      await fetchKaspaTransactions(user.walletAddress);
    }

    console.log('Kaspa deposit processing completed.');
  } catch (error) {
    console.error('Error processing Kaspa deposits:', error.message);
  }
}

module.exports = { processKaspaDeposits };
