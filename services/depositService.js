const axios = require('axios');
const cron = require('node-cron');
const User = require('../models/User');

// Define conversion rates
const CREDIT_CONVERSION = {
  KAS: 1 / 1,         // 1 credit = 1 KAS
  KASPER: 1 / 800     // 1 credit = 800 KASPER
};

/**
 * Fetch and process KRC20 (KASPER) transactions for a single user.
 */
async function processUserKasperDeposits(user) {
  const walletAddress = user.walletAddress;
  const url = `https://api.kasplex.org/v1/krc20/oplist?address=${walletAddress}&tick=KASPER`;

  const response = await axios.get(url);
  if (response.data.message !== "successful") {
    console.error(`Unexpected response for wallet ${walletAddress}:`, response.data);
    return;
  }

  const transactions = response.data.result || [];
  for (const tx of transactions) {
    const hashRev = tx.hashRev;
    const amt = parseInt(tx.amt, 10) / 1e8; 
    const opType = tx.op;
    const toAddress = tx.to;

    // Check if it's a deposit to this user not yet processed
    const alreadyProcessed = user.processedTransactions.some(
      (t) => t.txid === hashRev
    );
    if (
      opType.toLowerCase() === "transfer" && 
      toAddress === walletAddress && 
      !alreadyProcessed
    ) {
      // Credit user
      const creditsToAdd = amt * CREDIT_CONVERSION.KASPER;
      user.credits += creditsToAdd;

      // Save the transaction to user's DB record
      user.processedTransactions.push({
        txid: hashRev,
        coinType: "KASPER",
        amount: amt,
        creditsAdded: creditsToAdd,
        timestamp: new Date()
      });

      console.log(`Credited ${creditsToAdd} credits to user ${user.username} from KRC20 tx ${hashRev}`);
    }
  }
}

/**
 * Fetch and process Kaspa (KAS) transactions for a single user.
 */
async function processUserKaspaDeposits(user) {
  const kaspaAddress = user.walletAddress; 
  const url = `https://api.kaspa.org/addresses/${kaspaAddress}/full-transactions-page?limit=50&fields=resolve_previous_outpoints`;

  const response = await axios.get(url);
  const transactions = response.data || [];

  for (const tx of transactions) {
    const hash = tx.hash;
    if (!tx.outputs || tx.outputs.length === 0) continue;

    // Safely handle the first output
    const amount = parseInt(tx.outputs[0].amount, 10) / 1e8; 
    const toAddress = tx.outputs[0].script_public_key_address;

    // Check if it's a deposit to this user not yet processed
    const alreadyProcessed = user.processedTransactions.some(
      (t) => t.txid === hash
    );
    if (toAddress === kaspaAddress && !alreadyProcessed) {
      const creditsToAdd = amount * CREDIT_CONVERSION.KAS;
      user.credits += creditsToAdd;

      // Save the transaction to user's DB record
      user.processedTransactions.push({
        txid: hash,
        coinType: "KAS",
        amount: amount,
        creditsAdded: creditsToAdd,
        timestamp: new Date()
      });

      console.log(`Credited ${creditsToAdd} credits to user ${user.username} from KAS tx ${hash}`);
    }
  }
}

/**
 * Wrapper to process *one user's* deposits immediately.
 */
async function fetchAndProcessUserDeposits(walletAddress) {
  const user = await User.findOne({ walletAddress });
  if (!user) {
    throw new Error(`User not found for wallet ${walletAddress}`);
  }

  // Process KASPER & KAS for this user
  await processUserKasperDeposits(user);
  await processUserKaspaDeposits(user);

  // Save the user
  await user.save();
}


async function fetchAndProcessAllUsersKasper() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKasperDeposits(user);
    await user.save();
  }
}
async function fetchAndProcessAllUsersKaspa() {
  const users = await User.find({});
  for (const user of users) {
    await processUserKaspaDeposits(user);
    await user.save();
  }
}

/**
 * Initialize deposit processing schedules.
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
  fetchAndProcessUserDeposits // so we can call it on-demand
};
