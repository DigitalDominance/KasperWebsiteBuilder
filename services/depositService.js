// backend/services/depositService.js

const axios = require('axios');
const User = require('../models/User');

// 1 credit = 1 KAS, 1 credit = 1/800 KASPER
const CREDIT_CONVERSION = {
  KAS: 1 / 1,       // 1 credit = 1 KAS
  KASPER: 1 / 800   // 1 credit = 800 KASPER
};

/**
 * Fetch & Process KASPER deposits for a single user.
 */
async function processUserKasperDeposits(user) {
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const walletAddress = user.walletAddress;
  const url = `https://api.kasplex.org/v1/krc20/oplist?address=${walletAddress}&tick=KASPER`;

  try {
    const response = await axios.get(url);
    if (response.data.message !== "successful") {
      console.error(`Unexpected KASPER response for ${walletAddress}:`, response.data);
      return;
    }
    const transactions = response.data.result || [];

    for (const tx of transactions) {
      const hashRev = tx.hashRev;
      const amt = parseInt(tx.amt, 10) / 1e8;  // from sompi
      const opType = tx.op;
      const toAddress = tx.to;

      // skip if already processed
      const alreadyProcessed = user.processedTransactions.some(
        (t) => t.txid === hashRev
      );
      // Must be "transfer" to this user, not processed
      if (opType.toLowerCase() === "transfer" && toAddress === walletAddress && !alreadyProcessed) {
        const creditsToAdd = amt * CREDIT_CONVERSION.KASPER;
        user.credits += creditsToAdd;

        user.processedTransactions.push({
          txid: hashRev,
          coinType: "KASPER",
          amount: amt,
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
 * Fetch & Process Kaspa (KAS) deposits for a single user.
 */
async function processUserKaspaDeposits(user) {
  if (!Array.isArray(user.processedTransactions)) {
    user.processedTransactions = [];
  }

  const kaspaAddress = user.walletAddress;
  const url = `https://api.kaspa.org/addresses/${kaspaAddress}/full-transactions?limit=50&offset=0&resolve_previous_outpoints=no`;

  try {
    const response = await axios.get(url);
    // It's an array of tx objects
    const transactions = Array.isArray(response.data) ? response.data : [];

    for (const tx of transactions) {
      const txHash = tx.hash;
      if (!tx.outputs || tx.outputs.length === 0) continue;

      // Sum outputs that pay to this user
      let sumToUser = 0;
      for (const out of tx.outputs) {
        if (out.script_public_key_address === kaspaAddress) {
          // out.amount is in sompi => 1e8 = 1 KAS
          const outKas = parseInt(out.amount, 10) / 1e8;
          sumToUser += outKas;
        }
      }

      if (sumToUser > 0) {
        // skip if processed
        const alreadyProcessed = user.processedTransactions.some((t) => t.txid === txHash);
        if (!alreadyProcessed) {
          const creditsToAdd = sumToUser * CREDIT_CONVERSION.KAS;
          user.credits += creditsToAdd;

          user.processedTransactions.push({
            txid: txHash,
            coinType: "KAS",
            amount: sumToUser,
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
 * On-demand deposit check for a single user.
 */
async function fetchAndProcessUserDeposits(walletAddress) {
  const user = await User.findOne({ walletAddress });
  if (!user) {
    throw new Error(`User not found for wallet ${walletAddress}`);
  }

  await processUserKasperDeposits(user);
  await processUserKaspaDeposits(user);

  await user.save();
}

/**
 * Disabled or minimal deposit schedulers
 * (No constant scanning => Only on-demand from the front end).
 */
function initDepositSchedulers() {
  console.log("Deposit schedulers disabled to avoid constant scanning. Using on-demand scanning only.");
  // or if you want minimal scanning, you could do once a day, e.g.:
  // cron.schedule('0 0 * * *', async () => {
  //   console.log('Daily deposit check for all users...');
  //   await fetchAndProcessAllUsers();
  // });
}

module.exports = {
  initDepositSchedulers,
  fetchAndProcessUserDeposits
};
