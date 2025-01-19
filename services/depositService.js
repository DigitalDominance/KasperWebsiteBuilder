// backend/services/depositService.js

const axios = require('axios');
const cron = require('node-cron');
const User = require('../models/User');

// 1 credit = 1 KAS, and 1 credit = 1/800 KASPER
const CREDIT_CONVERSION = {
  KAS: 1 / 1,      // 1 credit per 1 KAS
  KASPER: 1 / 800  // 1 credit per 800 KASPER
};

/**
 * Fetch and process KRC20 (KASPER) transactions for a single user.
 */
async function processUserKasperDeposits(user) {
  // Make sure processedTransactions is at least an array
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const walletAddress = user.walletAddress;
  const url = `https://api.kasplex.org/v1/krc20/oplist?address=${walletAddress}&tick=KASPER`;

  try {
    const response = await axios.get(url);

    // If not "successful", skip
    if (response.data.message !== "successful") {
      console.error(`Unexpected KASPER response for wallet ${walletAddress}:`, response.data);
      return;
    }

    const transactions = response.data.result || [];
    for (const tx of transactions) {
      const hashRev = tx.hashRev;
      const amt = parseInt(tx.amt, 10) / 1e8; // KAS-likes from sompi
      const opType = tx.op;
      const toAddress = tx.to;

      // Check if not processed
      const alreadyProcessed = user.processedTransactions.some(
        (t) => t.txid === hashRev
      );

      // Must be "transfer" and to this wallet
      if (
        opType.toLowerCase() === "transfer" &&
        toAddress === walletAddress &&
        !alreadyProcessed
      ) {
        // 1 credit = 1/800 KASPER => multiply amt by (1/800)
        const creditsToAdd = amt * CREDIT_CONVERSION.KASPER;
        user.credits += creditsToAdd;

        // Save
        user.processedTransactions.push({
          txid: hashRev,
          coinType: "KASPER",
          amount: amt,
          creditsAdded: creditsToAdd,
          timestamp: new Date()
        });

        console.log(
          `Credited ${creditsToAdd.toFixed(8)} credits to user ${user.username} from KASPER tx ${hashRev}`
        );
      }
    }
  } catch (err) {
    console.error(`Error fetching KASPER for ${walletAddress}:`, err.message);
  }
}

/**
 * Fetch and process Kaspa (KAS) transactions for a single user using
 * the new "full-transactions" endpoint.
 */
async function processUserKaspaDeposits(user) {
  // Ensure processedTransactions is an array
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const kaspaAddress = user.walletAddress; 
  // NEW endpoint:
  // GET /addresses/{kaspaAddress}/full-transactions?limit=50&offset=0&resolve_previous_outpoints=no
  const url = `https://api.kaspa.org/addresses/${kaspaAddress}/full-transactions?limit=50&offset=0&resolve_previous_outpoints=no`;

  try {
    const response = await axios.get(url);
    // According to docs, we get an array of tx objects
    const transactions = Array.isArray(response.data) ? response.data : [];

    for (const tx of transactions) {
      const txHash = tx.hash;
      if (!tx.outputs || tx.outputs.length === 0) continue;

      // Sum all outputs that pay to user
      let sumToUser = 0;
      for (const out of tx.outputs) {
        if (out.script_public_key_address === kaspaAddress) {
          // out.amount is in sompi => 1 KAS = 1e8 sompi
          const outKas = parseInt(out.amount, 10) / 1e8;
          sumToUser += outKas;
        }
      }

      if (sumToUser > 0) {
        // Check if not processed
        const alreadyProcessed = user.processedTransactions.some(
          (t) => t.txid === txHash
        );

        if (!alreadyProcessed) {
          // 1 KAS => 1 credit
          const creditsToAdd = sumToUser * CREDIT_CONVERSION.KAS;
          user.credits += creditsToAdd;

          user.processedTransactions.push({
            txid: txHash,
            coinType: "KAS",
            amount: sumToUser,
            creditsAdded: creditsToAdd,
            timestamp: new Date()
          });

          console.log(
            `Credited ${creditsToAdd.toFixed(8)} credits to user ${user.username} from KAS tx ${txHash}`
          );
        }
      }
    }
  } catch (err) {
    console.error(`Error fetching KAS for ${kaspaAddress}:`, err.message);
  }
}

/**
 * On-demand: Process KASPER & KAS deposits for a single user.
 */
async function fetchAndProcessUserDeposits(walletAddress) {
  const user = await User.findOne({ walletAddress });
  if (!user) {
    throw new Error(`User not found for wallet ${walletAddress}`);
  }

  // 1) KASPER
  await processUserKasperDeposits(user);
  // 2) KAS
  await processUserKaspaDeposits(user);

  // Save
  await user.save();
}

/**
 * Process KASPER for ALL users.
 */
async function fetchAndProcessAllUsersKasper() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKasperDeposits(user);
    await user.save();
  }
}

/**
 * Process KAS for ALL users.
 */
async function fetchAndProcessAllUsersKaspa() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKaspaDeposits(user);
    await user.save();
  }
}

/**
 * Cron-based deposit checks, every 1 minute.
 */
function initDepositSchedulers() {
  // KASPER
  cron.schedule('*/1 * * * *', async () => {
    console.log('Fetching and processing KASPER deposits for all users...');
    await fetchAndProcessAllUsersKasper();
  });

  // KAS
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
