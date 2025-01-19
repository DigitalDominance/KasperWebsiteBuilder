require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { createWallet } = require('./wasm_rpc');
const User = require('./models/User');
const { initDepositSchedulers } = require('./services/depositService');
const crypto = require('crypto');
const { fetchAndProcessUserDeposits } = require('./services/depositService');

const app = express();

/**
 * CORS Configuration
 * Allows requests from production and development origins.
 */
const allowedOrigins = [
  'https://www.kaspercoin.net',
  'https://kaspercoin.net',
  'http://localhost:3000', // Frontend dev
  'http://localhost:8080'  // Additional dev
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = `The CORS policy for this site does not allow access from ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(bodyParser.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

// OpenAI config
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**************************************************
 * In-Memory Progress & Results
 **************************************************/
const progressMap = {};

/** Generate a random ID (for request tracking) */
function generateRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**************************************************
 * GET /
 **************************************************/
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder API is running!');
});

/**************************************************
 * POST /start-generation
 **************************************************/
app.post('/start-generation', async (req, res) => {
  const { walletAddress, userInputs } = req.body;
  if (!walletAddress || !userInputs) {
    return res.status(400).json({ error: "walletAddress and userInputs are required." });
  }

  try {
    // Decrement 1 credit if user has at least 1
    const user = await User.findOneAndUpdate(
      { walletAddress, credits: { $gte: 1 } },
      { $inc: { credits: -1 } },
      { new: true }
    );

    if (!user) {
      return res.status(400).json({ error: "Insufficient credits or invalid wallet address." });
    }

    const requestId = generateRequestId();

    progressMap[requestId] = {
      status: 'in-progress',
      progress: 0,
      code: null
    };

    doWebsiteGeneration(requestId, userInputs, user).catch(err => {
      console.error("Background generation error:", err);
      progressMap[requestId].status = 'error';
      progressMap[requestId].progress = 100;

      // Refund credit
      User.findOneAndUpdate({ walletAddress }, { $inc: { credits: 1 } })
        .then(() => {
          console.log(`Refunded 1 credit to ${walletAddress} due to generation failure.`);
        })
        .catch(refundErr => {
          console.error(`Failed to refund credit for user ${walletAddress}:`, refundErr);
        });
    });

    return res.json({ requestId });
  } catch (err) {
    console.error("Error starting generation:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**************************************************
 * GET /progress?requestId=XYZ
 **************************************************/
app.get('/progress', (req, res) => {
  const { requestId } = req.query;
  if (!requestId || !progressMap[requestId]) {
    return res.status(400).json({ error: "Invalid or missing requestId" });
  }
  const { status, progress } = progressMap[requestId];
  return res.json({ status, progress });
});

/**************************************************
 * GET /result?requestId=XYZ
 **************************************************/
app.get('/result', (req, res) => {
  const { requestId } = req.query;
  if (!requestId || !progressMap[requestId]) {
    return res.status(400).json({ error: "Invalid or missing requestId" });
  }

  const { status, code } = progressMap[requestId];
  if (status !== 'done') {
    return res.status(400).json({ error: "Not finished or generation error." });
  }
  return res.json({ code });
});

/**************************************************
 * GET /export?requestId=XYZ&type=full|wordpress
 **************************************************/
app.get('/export', (req, res) => {
  const { requestId, type } = req.query;
  if (!requestId || !progressMap[requestId]) {
    return res.status(400).json({ error: "Invalid or missing requestId" });
  }

  const { status, code } = progressMap[requestId];
  if (status !== 'done') {
    return res.status(400).json({ error: "Generation not completed or encountered an error." });
  }

  if (!type || !['full', 'wordpress'].includes(type)) {
    return res.status(400).json({ error: "Invalid or missing export type. Use 'full' or 'wordpress'." });
  }

  const filename = sanitizeFilename(requestId);

  if (type === 'full') {
    // Export as full HTML
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_website.html"`);
    return res.send(code);
  } else {
    // WordPress template
    const wordpressTemplate = `<?php
/**
 * Template Name: ${filename}_Generated_Website
 */
get_header(); ?>

<div id="generated-website">
${code}
</div>

<?php get_footer(); ?>
`;
    res.setHeader('Content-Type', 'application/php');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_generated_website.php"`);
    return res.send(wordpressTemplate);
  }
});

/**************************************************
 * GET /get-credits?walletAddress=XYZ
 **************************************************/
app.get('/get-credits', async (req, res) => {
  const { walletAddress } = req.query;
  if (!walletAddress) {
    return res.status(400).json({ success: false, error: "walletAddress is required." });
  }

  try {
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid wallet address." });
    }
    return res.json({ success: true, credits: user.credits });
  } catch (err) {
    console.error("Error fetching credits:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * POST /create-wallet
 **************************************************/
app.post('/create-wallet', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    // check if username exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "Username already exists. Please choose another one." });
    }

    // create new wallet
    const walletData = await createWallet();
    if (!walletData.success) {
      return res.status(500).json({ success: false, error: "Wallet creation failed." });
    }

    const { receivingAddress, xPrv, mnemonic } = walletData;

    // password hashing
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // new user
    const newUser = new User({
      username,
      walletAddress: receivingAddress,
      passwordHash,
      xPrv,
      mnemonic,
      credits: 1, 
      generatedFiles: []
    });

    await newUser.save();
    return res.json({ success: true, walletAddress: receivingAddress });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
      return res.status(400).json({ success: false, error: "Username already exists. Please choose another one." });
    }
    console.error("Error creating wallet:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * POST /connect-wallet
 **************************************************/
app.post('/connect-wallet', async (req, res) => {
  const { walletAddress, password } = req.body;
  if (!walletAddress || !password) {
    return res.status(400).json({ success: false, error: "Wallet address and password are required." });
  }

  try {
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid wallet address or password." });
    }

    // password check
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(400).json({ success: false, error: "Invalid wallet address or password." });
    }

    return res.json({
      success: true,
      username: user.username,
      walletAddress: user.walletAddress,
      credits: user.credits,
      generatedFiles: user.generatedFiles
    });
  } catch (err) {
    console.error("Error connecting wallet:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * POST /scan-deposits
 **************************************************/
app.post('/scan-deposits', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ success: false, error: "Missing walletAddress" });
  }

  try {
    await fetchAndProcessUserDeposits(walletAddress);

    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    return res.json({ success: true, credits: user.credits });
  } catch (err) {
    console.error("Error scanning deposits on demand:", err);
    return res.status(500).json({ success: false, error: "Failed to scan deposits" });
  }
});

/**************************************************
 * POST /save-generated-file
 **************************************************/
app.post('/save-generated-file', async (req, res) => {
  const { walletAddress, requestId, content } = req.body;
  if (!walletAddress || !requestId || !content) {
    return res.status(400).json({ success: false, error: "All fields are required." });
  }

  try {
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid wallet address." });
    }
    user.generatedFiles.push({ requestId, content });
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("Error saving generated file:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * Background Generation Function
 **************************************************/
async function doWebsiteGeneration(requestId, userInputs, user) {
  try {
    const { coinName, colorPalette, projectDesc } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing 'coinName' or 'colorPalette'.");
    }

    progressMap[requestId].progress = 10;

    // Inspiration snippet
    const snippetInspiration = `
<html>
<head>
  <style>
    /* Example gradient & shimmer */
    body {
      margin: 0; padding: 0;
      font-family: sans-serif;
    }
    .shimmer-bg {
      background: linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 100%);
      background-size: 200% 200%;
      animation: shimmerMove 2s infinite;
    }
    @keyframes shimmerMove {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  </style>
</head>
<body>
  <!-- snippet with shimmer -->
</body>
</html>
`;

    // GPT system instructions with new disclaimers about "insanely beautiful", glass sections, etc.
    const systemMessage = `
You are GPT-4o, an advanced website-building AI. Make the single-page HTML/CSS/JS site extremely beautiful, with:

- **Insane** design details: fully responsive all components for mobile and computer, make sure buttons are fake and not actually clickable, strong gradients, glassmorphism sections, advanced transitions, gradient text, popular appealing fonts. Black or white should be added as a primary with their chosen color pallette.
- Make sure all the components flow nicely/contrast with the bg colors. make the background mainly black or white. and ensure the componenets contrast nice. now they dont.
- Each Section should flow nice between eachother and have a nice gradient background that compliment eachother or just flow nice. make the gradient from color palette "${colorPalette}" and either black or white. to make a nice background gradient.
- Non-sticky nav: Left has IMAGE_PLACEHOLDER_LOGO (small circular token logo), Right has unclickable links: [Home, Roadmap, Tokenomics, etc.]. for mobile make the nav the logo on the left and the right have a button they click with the dropdown of the unclickable links. 
- A big modern hero/splash below the nav. 
  - Uses 1024x1024 IMAGE_PLACEHOLDER_BG as background (from color palette "${colorPalette}").
  - Large heading = "${coinName}", referencing projectDesc: "${projectDesc}".
  - Buttons (like "Buy" or "Learn More") appear but are placeholders only (not actually clickable). Pick one button, dont add 2.
- A vertical roadmap (5 steps) with fancy progress bars or connectors that interacts as scrolled. (fills the progess bar color). 
- A tokenomics section with 3 cards, each a fancy gradient or glass block as a card and a nice text on top to compliment it. (cool hover effects)
- An exchanges/analytics section with 6 placeholder blocks. (cool hover effects and gradient headings) give it a flex hero layout. on desktop should be 3 in each row with 2 rows. on mobile u decide.
- A two card section that is an about section with the two cards being Why "${coinName}" and other being Our mission or something along the lines. Nice glass cards that are gradient matched for the color palette "${colorPalette}" and the bg colors of that section "
- **Footer** at the bottom (non-sticky), containing disclaimers, Telegram link placeholder, X link placeholder, and re-using IMAGE_PLACEHOLDER_LOGO. 
- Entire site must be fully responsive, extremely well-styled, with advanced shimmer or glass transitions. 
- **No leftover code fences** or triple backticks. Output as one single HTML <head> + <body> block with all styling included. 
- The hero background must be the 1024x1024 image, the token logo is 256x256, both placeholders must be replaced. 
- Buttons are placeholders only: they look like buttons but do nothing on click.

Use snippet below for partial inspiration (no code fences):

${snippetInspiration}
`;

    progressMap[requestId].progress = 20;

    // Generate the site with GPT
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: `Generate the single-file site now. Must have insane design, transitions, advanced glass, placeholders for Telegram & X in the footer. All consistent with colorPalette: ${colorPalette}, coinName: ${coinName}, and projectDesc: ${projectDesc}. No leftover code fences.` }
      ],
      max_tokens: 3500,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 40;

    // Prepare placeholders
    const placeholders = {};

    // Generate the transparent circular token logo (256x256)
    progressMap[requestId].progress = 50;
    try {
      const logoPrompt = `Transparent circular token logo, 256x256, for a memecoin called "${coinName}". 
                          Color palette: "${colorPalette}", vibe: ${projectDesc}.
                          Must match coin name and have no extra text or background elements. 
                          Very eye-catching, simple, only the logo.`;

      const logoResp = await openai.createImage({
        prompt: logoPrompt,
        n: 1,
        size: "256x256"
      });
      const logoUrl = logoResp.data.data[0].url;
      const logoFetch = await fetch(logoUrl);
      const logoBuffer = await logoFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_LOGO"] =
        "data:image/png;base64," + Buffer.from(logoBuffer).toString("base64");
    } catch (err) {
      console.error("Logo generation error:", err);
      // fallback
      placeholders["IMAGE_PLACEHOLDER_LOGO"] =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    // Generate the 1024x1024 BG hero
    progressMap[requestId].progress = 60;
    try {
      const bgPrompt = `1024x1024 advanced gradient/shimmer background for a memecoin hero section called "${coinName}", 
                        color palette: "${colorPalette}" and black or white as a primary, referencing ${projectDesc}, 
                        futuristic, extremely nice, consistent with project vibe. 
                        This is the main hero splash background. 
                        Must match coin name & color.`;

      const bgResp = await openai.createImage({
        prompt: bgPrompt,
        n: 1,
        size: "1024x1024"
      });
      const bgUrl = bgResp.data.data[0].url;
      const bgFetch = await fetch(bgUrl);
      const bgBuffer = await bgFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_BG"] =
        "data:image/png;base64," + Buffer.from(bgBuffer).toString("base64");
    } catch (err) {
      console.error("BG generation error:", err);
      // fallback
      placeholders["IMAGE_PLACEHOLDER_BG"] =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    progressMap[requestId].progress = 80;

    // Replace placeholders
    for (const phKey of Object.keys(placeholders)) {
      const base64Uri = placeholders[phKey];
      const regex = new RegExp(phKey, "g");
      siteCode = siteCode.replace(regex, base64Uri);
    }

    // remove triple backticks
    siteCode = siteCode.replace(/```+/g, "");

    progressMap[requestId].progress = 90;

    // Assign final code
    progressMap[requestId].code = siteCode;
    progressMap[requestId].status = "done";
    progressMap[requestId].progress = 100;

    // Save to user's generated files
    user.generatedFiles.push({
      requestId,
      content: siteCode
    });
    await user.save();

  } catch (error) {
    console.error("Error in background generation:", error);
    progressMap[requestId].status = "error";
    progressMap[requestId].progress = 100;
  }
}


/**************************************************
 * Initialize Deposit Schedulers
 **************************************************/
initDepositSchedulers();

/**************************************************
 * Error Handling Middleware
 **************************************************/
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError) {
    console.error("Syntax Error:", err);
    return res.status(400).json({ error: "Invalid JSON payload." });
  } else if (err.message && err.message.startsWith('The CORS policy')) {
    console.error("CORS Error:", err.message);
    return res.status(403).json({ error: err.message });
  }
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

/**************************************************
 * Launch the Server
 **************************************************/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KasperCoin Website Builder API running on port ${PORT}!`);
});
