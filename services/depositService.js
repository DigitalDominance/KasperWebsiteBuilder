// backend/services/depositService.js

const axios = require('axios');
const cron = require('node-cron');
const User = require('../models/User');

// Define conversion rates
// => 1 credit = 1 KAS, 1 credit = 800 KASPER
const CREDIT_CONVERSION = {
  KAS: 1 / 1,      // 1 credit per 1 KAS
  KASPER: 1 / 800  // 1 credit per 800 KASPER
};

/**
 * Fetch and process KRC20 (KASPER) transactions for a single user.
 */
async function processUserKasperDeposits(user) {
  // If somehow processedTransactions is missing, define it as an array
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const walletAddress = user.walletAddress;
  const url = `https://api.kasplex.org/v1/krc20/oplist?address=${walletAddress}&tick=KASPER`;

  try {
    const response = await axios.get(url);
    // If we don't get a successful message, skip
    if (response.data.message !== "successful") {
      console.error(`Unexpected KASPER response for wallet ${walletAddress}:`, response.data);
      return;
    }

    const transactions = response.data.result || [];
    for (const tx of transactions) {
      const hashRev = tx.hashRev;        // unique ID for KRC20 transfer
      const amt = parseInt(tx.amt, 10) / 1e8; // from sompi to KAS-like units
      const opType = tx.op;
      const toAddress = tx.to;

      // Check if it's a deposit not yet processed
      const alreadyProcessed = user.processedTransactions.some(
        (t) => t.txid === hashRev
      );

      // Must be "transfer" to this user address, not processed yet
      if (
        opType.toLowerCase() === "transfer" &&
        toAddress === walletAddress &&
        !alreadyProcessed
      ) {
        const creditsToAdd = amt * CREDIT_CONVERSION.KASPER;
        user.credits += creditsToAdd;

        // Record the TX in the user's processedTransactions
        user.processedTransactions.push({
          txid: hashRev,
          coinType: "KASPER",
          amount: amt,            // how many KASPER (1 "amt" here is KAS-likes, effectively)
          creditsAdded: creditsToAdd,
          timestamp: new Date()
        });

        console.log(`Credited ${creditsToAdd.toFixed(8)} credits to user ${user.username} from KASPER tx ${hashRev}`);
      }
    }
  } catch (err) {
    console.error(`Error fetching KASPER for ${walletAddress}:`, err.message);
  }
}

/**
 * Fetch and process Kaspa (KAS) transactions for a single user.
 */
async function processUserKaspaDeposits(user) {
  // Ensure user.processedTransactions is an array
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const kaspaAddress = user.walletAddress; // e.g. "kaspa:qqk..."
  // The "full-transactions-page" endpoint can vary. We can use "limit=50" or "limit=100" as you prefer:
  const url = `https://api.kaspa.org/addresses/${kaspaAddress}/full-transactions-page?limit=50&fields=resolve_previous_outpoints`;

  try {
    const response = await axios.get(url);
    const transactions = response.data || [];

    for (const tx of transactions) {
      const txHash = tx.hash;
      if (!tx.outputs || tx.outputs.length === 0) continue;

      // Sum up all outputs that pay to user
      let sumToUser = 0;
      for (const out of tx.outputs) {
        // If the output's address matches user's address, add it
        if (out.script_public_key_address === kaspaAddress) {
          // out.amount is in sompi => 1 KAS = 1e8 sompi
          const outKas = parseInt(out.amount, 10) / 1e8;
          sumToUser += outKas;
        }
      }

      if (sumToUser > 0) {
        // Check if we have processed this txHash
        const alreadyProcessed = user.processedTransactions.some(
          (t) => t.txid === txHash
        );

        if (!alreadyProcessed) {
          // 1 KAS = 1 credit => multiply sumToUser by 1
          const creditsToAdd = sumToUser * CREDIT_CONVERSION.KAS;
          user.credits += creditsToAdd;

          // Save the transaction to user's DB record
          user.processedTransactions.push({
            txid: txHash,
            coinType: "KAS",
            amount: sumToUser,       // KAS
            creditsAdded: creditsToAdd,
            timestamp: new Date()
          });

          console.log(`Credited ${creditsToAdd.toFixed(8)} credits to user ${user.username} from KAS tx ${txHash}`);
        }
      }
    }
  } catch (err) {
    console.error(`Error fetching KAS for ${kaspaAddress}:`, err.message);
  }
}

/**
 * Process KASPER & KAS deposits for a single user immediately.
 */
async function fetchAndProcessUserDeposits(walletAddress) {
  const user = await User.findOne({ walletAddress });
  if (!user) {
    throw new Error(`User not found for wallet ${walletAddress}`);
  }

  // Process KASPER & KAS for this user
  await processUserKasperDeposits(user);
  await processUserKaspaDeposits(user);

  // Save
  await user.save();
}

/**
 * Process KASPER for ALL users
 */
async function fetchAndProcessAllUsersKasper() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKasperDeposits(user);
    await user.save();
  }
}

/**
 * Process KAS for ALL users
 */
async function fetchAndProcessAllUsersKaspa() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKaspaDeposits(user);
    await user.save();
  }
}

/**
 * Initialize deposit processing schedules.
 * => Called from server.js at startup
 */
function initDepositSchedulers() {
  // KASPER every 1 minute
  cron.schedule('*/1 * * * *', async () => {
    console.log('Fetching and processing KASPER deposits for all users...');
    await fetchAndProcessAllUsersKasper();
  });

  // KAS every 1 minute
  cron.schedule('*/1 * * * *', async () => {
    console.log('Fetching and processing KAS deposits for all users...');
    await fetchAndProcessAllUsersKaspa();
  });

  console.log('Deposit schedulers initialized.');
}

module.exports = {
  initDepositSchedulers,
  fetchAndProcessUserDeposits
};
