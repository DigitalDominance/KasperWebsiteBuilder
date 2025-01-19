// backend/services/depositService.js

const axios = require('axios');
const cron = require('node-cron');
const User = require('../models/User');
const mongoose = require('mongoose');

// Define conversion rates
const CREDIT_CONVERSION = {
  KAS: 1 / 5,        // 1 credit = 5 KAS
  KASPER: 1 / 340    // 1 credit = 340 KASPER
};

// Initialize a set to store processed transaction hashes
const processedTransactions = new Set();

/**
 * Fetch and process KRC20 (Kasper) transactions for all users.
 */
async function fetchAndProcessKasperDeposits() {
  try {
    const users = await User.find({});
    for (const user of users) {
      const walletAddress = user.walletAddress;
      const url = `https://api.kasplex.org/v1/krc20/oplist?address=${walletAddress}&tick=KASPER`;

      const response = await axios.get(url);
      if (response.data.message !== "successful") {
        console.error(`Unexpected response for wallet ${walletAddress}:`, response.data);
        continue;
      }

      const transactions = response.data.result || [];
      for (const tx of transactions) {
        const hashRev = tx.hashRev;
        const amt = parseInt(tx.amt, 10) / 1e8; // Convert from sompi to KAS
        const opType = tx.op;
        const toAddress = tx.to;

        // Ensure it's a TRANSFER to the correct address and not already processed
        if (opType.toLowerCase() === "transfer" && toAddress === walletAddress && !processedTransactions.has(hashRev)) {
          // Credit the user's account
          const creditsToAdd = amt * CREDIT_CONVERSION.KASPER;
          user.credits += creditsToAdd;

          // Save the transaction as processed
          processedTransactions.add(hashRev);

          console.log(`Credited ${creditsToAdd} credits to user ${user.username} from KRC20 transaction ${hashRev}`);
        }
      }

      // Save the updated user
      await user.save();
    }
  } catch (error) {
    console.error("Error fetching KRC20 transactions:", error.message);
  }
}

/**
 * Fetch and process Kaspa (KAS) transactions for all users.
 */
async function fetchAndProcessKaspaDeposits() {
  try {
    const users = await User.find({});
    for (const user of users) {
      const kaspaAddress = user.walletAddress; // Assuming same as Kasper wallet
      const url = `https://api.kaspa.org/addresses/${kaspaAddress}/full-transactions-page?limit=50&fields=resolve_previous_outpoints`;

      const response = await axios.get(url);
      const transactions = response.data || [];

      for (const tx of transactions) {
        const hash = tx.hash;
        const amount = parseInt(tx.outputs[0].amount, 10) / 1e8; // Convert from sompi to KAS
        const toAddress = tx.outputs[0].script_public_key_address;

        // Ensure it's a transaction to the user's address and not already processed
        if (toAddress === kaspaAddress && !processedTransactions.has(hash)) {
          // Credit the user's account
          const creditsToAdd = amount * CREDIT_CONVERSION.KAS;
          user.credits += creditsToAdd;

          // Save the transaction as processed
          processedTransactions.add(hash);

          console.log(`Credited ${creditsToAdd} credits to user ${user.username} from Kaspa transaction ${hash}`);
        }
      }

      // Save the updated user
      await user.save();
    }
  } catch (error) {
    console.error("Error fetching Kaspa transactions:", error.message);
  }
}

/**
 * Initialize deposit processing schedules.
 */
function initDepositSchedulers() {
  // Schedule Kasper KRC20 deposit processing every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('Fetching and processing Kasper KRC20 deposits...');
    await fetchAndProcessKasperDeposits();
  });

  // Schedule Kaspa deposit processing every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('Fetching and processing Kaspa deposits...');
    await fetchAndProcessKaspaDeposits();
  });

  console.log('Deposit schedulers initialized.');
}

module.exports = { initDepositSchedulers };
