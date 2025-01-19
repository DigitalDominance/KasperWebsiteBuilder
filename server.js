// backend/server.js

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

const app = express();

/**
 * CORS: allow requests from both https://www.kaspercoin.net and https://kaspercoin.net
 */
app.use(cors({
  origin: [
    'https://www.kaspercoin.net',
    'https://kaspercoin.net'
  ],
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

/**************************************************
 * GET /
 **************************************************/
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder API is running!');
});

/**************************************************
 * POST /start-generation
 * Expects:
 * {
 *   walletAddress: "UserWalletAddress",
 *   userInputs: {
 *     coinName: "SomeCoin",
 *     colorPalette: "purple and neon-blue",
 *     projectDesc: "futuristic memecoin style"
 *   }
 * }
 * Returns { requestId }
 **************************************************/
app.post('/start-generation', async (req, res) => {
  const { walletAddress, userInputs } = req.body;

  if (!walletAddress || !userInputs) {
    return res.status(400).json({ error: "walletAddress and userInputs are required." });
  }

  // Verify user exists
  const user = await User.findOne({ walletAddress });
  if (!user) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  const requestId = generateRequestId();

  progressMap[requestId] = {
    status: 'in-progress',
    progress: 0,
    code: null
  };

  // Start background generation
  doWebsiteGeneration(requestId, userInputs, user)
    .catch(err => {
      console.error("Background generation error:", err);
      progressMap[requestId].status = 'error';
      progressMap[requestId].progress = 100;
    });

  return res.json({ requestId });
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

  if (type === 'full') {
    // Export as full HTML file
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(requestId)}_website.html"`);
    return res.send(code);
  } else if (type === 'wordpress') {
    // Wrap the HTML into a WordPress page template
    const wordpressTemplate = `<?php
/**
 * Template Name: ${sanitizeFilename(requestId)}_Generated_Website
 */
get_header(); ?>

<div id="generated-website">
${code}
</div>

<?php get_footer(); ?>
`;

    res.setHeader('Content-Type', 'application/php');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(requestId)}_generated_website.php"`);
    return res.send(wordpressTemplate);
  }
}); // Corrected closure

/**************************************************
 * POST /create-wallet
 * Expects:
 * {
 *   username: "UserName",
 *   password: "UserPassword"
 * }
 * Returns { success: true, walletAddress }
 **************************************************/
app.post('/create-wallet', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    // Check if username already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ success: false, error: "Username already exists." });
    }

    // Create wallet using wasm_rpc.js
    const walletData = await createWallet();

    if (!walletData.success) {
      return res.status(500).json({ success: false, error: "Wallet creation failed." });
    }

    const { receivingAddress, xPrv, mnemonic } = walletData;

    // Hash the password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const newUser = new User({
      username,
      walletAddress: receivingAddress,
      passwordHash,
      xPrv,
      mnemonic,
      credits: 0,
      generatedFiles: []
    });

    await newUser.save();

    return res.json({ success: true, walletAddress: receivingAddress });
  } catch (err) {
    console.error("Error creating wallet:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * POST /connect-wallet
 * Expects:
 * {
 *   walletAddress: "UserWalletAddress",
 *   password: "UserPassword"
 * }
 * Returns { success: true, username, walletAddress, credits, generatedFiles }
 **************************************************/
app.post('/connect-wallet', async (req, res) => {
  const { walletAddress, password } = req.body;

  if (!walletAddress || !password) {
    return res.status(400).json({ success: false, error: "Wallet address and password are required." });
  }

  try {
    // Find user by walletAddress
    const user = await User.findOne({ walletAddress });

    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid wallet address or password." });
    }

    // Compare password
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
 * POST /save-generated-file
 * Expects:
 * {
 *   walletAddress: "UserWalletAddress",
 *   requestId: "XYZ",
 *   content: "Generated HTML Content"
 * }
 * Returns { success: true }
 **************************************************/
app.post('/save-generated-file', async (req, res) => {
  const { walletAddress, requestId, content } = req.body;

  if (!walletAddress || !requestId || !content) {
    return res.status(400).json({ success: false, error: "All fields are required." });
  }

  try {
    // Find user by walletAddress
    const user = await User.findOne({ walletAddress });

    if (!user) {
      return res.status(400).json({ success: false, error: "Invalid wallet address." });
    }

    // Add generated file to user's generatedFiles
    user.generatedFiles.push({
      requestId,
      content
    });

    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("Error saving generated file:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
});

/**************************************************
 * Utility to sanitize filenames
 **************************************************/
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

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

    // This snippet is used as inspiration for shimmer, gradients, pinned footer, etc.
    const snippetInspiration = `
<html>
<head>
  <style>
    /* Example gradient & shimmer */
    body {
      margin: 0; padding: 0;
      font-family: sans-serif;
      /* We want a strong gradient that matches user's colorPalette. */
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
  <!-- Example snippet with shimmer -->
</body>
</html>
`;

    // GPT system instructions
    const systemMessage = `
You are GPT-4o, an advanced website building AI, the best of them all. 
Produce a single-page highly advanced and beautiful HTML/CSS/JS site based on kaspercoin.net with the following specifications:

1) **Non-Sticky Nav (Top)**
   - Contains IMAGE_PLACEHOLDER_LOGO on the left.
   - Unclickable links (Home, Roadmap, Tokenomics, etc.) on the right.

2) **Modern Beautiful Hero/Splash Below Nav**
   - Uses a strong gradient background derived from "${colorPalette}".
   - Includes IMAGE_PLACEHOLDER_BG as a decorative background or element.
   - Big heading displaying the coin name: "${coinName}".
   - Subheading referencing the project description: "${projectDesc}".
   - No sticky behavior.

3) **Roadmap Section**
   - Vertical timeline or steps, each with a small progress bar.
   - Use placeholder content.

4) **Tokenomics Section**
   - Heading for Tokenomics.
   - Exactly 3 cards laid out vertically with clean animations and crisp gradients.

4.1) **Exchanges/Analytics Section**
    - 6 card section that has a heading above it.
    - Flex grid layout and each card has an exchange or analytics platform to find their token on
    - Use placeholders

5) **Footer at Bottom (Non-Sticky)**
   - Contains disclaimers, social links, etc.
   - Includes IMAGE_PLACEHOLDER_LOGO.
   - Must appear at the end of page content (not pinned/sticky).

6) **Advanced Styling**
   - Incorporate shimmer effects, transitions, and the provided colorPalette for gradients.
   - Fully responsive design for desktop and mobile.
   - Absolutely incorporate the colorPalette in the main backgrounds or sections.

7) **Images**
   - Must relate to coinName & projectDesc (to be used in DALL·E prompts).

8) **Output Format**
   - No leftover code fences or triple backticks.
   - Output in ONE file with:
     <!DOCTYPE html>
     <html>
       <head>
         <meta charset="UTF-8"/>
         <title>${coinName}</title>
         <style> ... MUST USE colorPalette in gradients ... </style>
       </head>
       <body>
         <!-- nav, hero, roadmap timeline, tokenomics (3 cards), footer. 
              Non-sticky nav or footer. 
              Must visually show gradient from colorPalette. 
              Must show advanced shimmer or transitions. 
         -->
         <script> ... any needed JS ... </script>
       </body>
     </html>
   - Make sure to include all the final beautiful HTML, CSS, and JS. Quality is the most important thing. Add gradients from either white or black and our color palette in the backgrounds. Make it nice.

Use the snippet below as partial inspiration (but do not include code fences in your output):

${snippetInspiration}

Now generate the final code in one fully mobile and desktop responsive beautiful block with all HTML, CSS, and JS included.
`;

    progressMap[requestId].progress = 20;

    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: "Generate the single-file site now, strictly following colorPalette, non-sticky nav/footer, 3 token cards, vertical roadmap timeline, no leftover code fences. Beautiful styling. Responsive. Modern." }
      ],
      max_tokens: 3500,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 40;

    // Generate 2 images with DALL·E:
    // 1) IMAGE_PLACEHOLDER_LOGO => must relate to coinName & projectDesc
    // 2) IMAGE_PLACEHOLDER_BG => must reference colorPalette & coinName too
    const placeholders = {};

    // (A) LOGO
    progressMap[requestId].progress = 50;
    try {
      const logoPrompt = `logo for a memecoin called "${coinName}", color palette "${colorPalette}", project vibe: ${projectDesc}, small eye-catching design. Must match coin name.`;
      const logoResp = await openai.createImage({
        prompt: logoPrompt,
        n: 1,
        size: "256x256"
      });
      const logoUrl = logoResp.data.data[0].url;
      const logoFetch = await fetch(logoUrl);
      const logoBuffer = await logoFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_LOGO"] = "data:image/png;base64," + Buffer.from(logoBuffer).toString('base64');
    } catch (err) {
      console.error("Logo generation error:", err);
      placeholders["IMAGE_PLACEHOLDER_LOGO"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    // (B) BG
    progressMap[requestId].progress = 60;
    try {
      const bgPrompt = `hero background for a memecoin called "${coinName}", color palette "${colorPalette}", referencing ${projectDesc}, advanced gradient or shimmer, futuristic. Must match coin name and color vibe.`;
      const bgResp = await openai.createImage({
        prompt: bgPrompt,
        n: 1,
        size: "256x256"
      });
      const bgUrl = bgResp.data.data[0].url;
      const bgFetch = await fetch(bgUrl);
      const bgBuffer = await bgFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_BG"] = "data:image/png;base64," + Buffer.from(bgBuffer).toString('base64');
    } catch (err) {
      console.error("BG generation error:", err);
      placeholders["IMAGE_PLACEHOLDER_BG"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    progressMap[requestId].progress = 80;

    // Replace placeholders
    Object.keys(placeholders).forEach(phKey => {
      const base64Uri = placeholders[phKey];
      const regex = new RegExp(phKey, 'g');
      siteCode = siteCode.replace(regex, base64Uri);
    });

    // Remove triple backticks
    siteCode = siteCode.replace(/```+/g, '');

    progressMap[requestId].progress = 90;

    progressMap[requestId].code = siteCode;
    progressMap[requestId].status = 'done';
    progressMap[requestId].progress = 100;

    // Save generated file to user's account
    user.generatedFiles.push({
      requestId,
      content: siteCode
    });
    await user.save();

  } catch (error) {
    console.error("Error in background generation:", error);
    progressMap[requestId].status = 'error';
    progressMap[requestId].progress = 100;
  }
}

/**************************************************
 * Initialize Deposit Schedulers
 **************************************************/
initDepositSchedulers();

/**************************************************
 * Launch the Server
 **************************************************/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KasperCoin Website Builder API running on port ${PORT}!`);
});
