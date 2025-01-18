require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
const fetch = require('node-fetch');

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

// OpenAI config
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**************************************************
 * In-Memory Progress & Results
 **************************************************/
const progressMap = {}; 
// progressMap[requestId] = {
//   status: 'in-progress' | 'done' | 'error',
//   progress: number, // 0..100
//   code: string | null
// };

/** Generate a random ID (for request tracking) */
function generateRequestId() {
  return Math.random().toString(36).substr(2, 9); 
}

/**************************************************
 * GET /
 **************************************************/
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder with Progress Tracking is running!');
});

/**************************************************
 * POST /start-generation
 * Expects JSON like:
 * {
 *   userInputs: {
 *     coinName: "SomeCoin",
 *     colorPalette: "neon-green and dark",
 *     projectDesc: "futuristic memecoin style"
 *   }
 * }
 * Returns { requestId }
 **************************************************/
app.post('/start-generation', (req, res) => {
  // 1) Generate requestId
  const requestId = generateRequestId();

  // 2) Initialize progress
  progressMap[requestId] = {
    status: 'in-progress',
    progress: 0,
    code: null
  };

  // 3) Start background generation (async)
  doWebsiteGeneration(requestId, req.body.userInputs)
    .catch(err => {
      console.error("Background generation error:", err);
      progressMap[requestId].status = 'error';
      progressMap[requestId].progress = 100;
    });

  // 4) Return requestId immediately
  return res.json({ requestId });
});

/**************************************************
 * GET /progress?requestId=XYZ
 * Returns { status, progress }
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
 * Returns { code } if status === 'done'
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
 * Background Generation Function
 **************************************************/
async function doWebsiteGeneration(requestId, userInputs) {
  try {
    // Basic checks
    const { coinName, colorPalette, projectDesc } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing 'coinName' or 'colorPalette'.");
    }

    // 1) Start
    progressMap[requestId].progress = 10;

    // 2) Create the GPT system instructions for advanced styling & placeholders
    const systemMessage = `
      You are a coding AI specialized in building extremely modern, visually stunning,
      single-page memecoin websites. Produce a single HTML/CSS/JS file (all in one)
      that includes advanced animations, modern layout, and a highly polished design.

      REQUIRED SECTIONS (in order, top to bottom):
      1) NAVIGATION BAR at the top:
         - Left side: a small token logo placeholder (IMAGE_PLACEHOLDER_LOGO).
         - Right side: nav links (Home, Tokenomics, Roadmap, FAQ).
      2) SPLASH (HERO) SECTION:
         - Full-width, full-height hero with background image placeholder (IMAGE_PLACEHOLDER_BG).
         - Big bold headline for the coin name: "${coinName}".
         - Possibly a short subheader or tagline referencing the color palette: "${colorPalette}".
         - A call-to-action button with a nice hover or click animation.
      3) TOKENOMICS SECTION:
         - Key stats about supply, distribution, etc. (just sample text).
         - Modern animations or transitions.
      4) ROADMAP SECTION:
         - A timeline or milestone cards with subtle transitions.
      5) FAQ SECTION:
         - Accordion or collapsible items with smooth animation.
      6) FOOTER at the bottom:
         - Typical memecoin disclaimers, social links (X/Twitter, Telegram).
         - Must be visually anchored to the page bottom if content is short.

      ADDITIONAL STYLING/ANIMATION REQUIREMENTS:
      - Use advanced modern styling (e.g., gradients, transitions, keyframe animations).
      - Fully responsive (mobile, tablet, desktop).
      - Well-commented code if needed, minimal JS for interactivity (e.g. FAQ accordion).
      - Output everything in one file, with placeholders:
        IMAGE_PLACEHOLDER_LOGO for the nav logo,
        IMAGE_PLACEHOLDER_BG for the hero background.
      - No additional explanation or text, just the HTML/CSS/JS in one file.

      The user also provided a short project description: "${projectDesc}". Feel free to
      incorporate that vibe or style (e.g., futuristic, comedic, etc.) into the design.
    `;

    progressMap[requestId].progress = 20;

    // 3) Call GPT (ChatCompletion) to get the single-page code
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: "Generate the single-page site code now." }
      ],
      max_tokens: 2000,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 40;

    // 4) We have 2 placeholders to fill:
    //    1) IMAGE_PLACEHOLDER_LOGO
    //    2) IMAGE_PLACEHOLDER_BG
    // We'll create 2 separate DALL·E images for them.

    const placeholders = {};

    // (A) Generate LOGO
    progressMap[requestId].progress = 50;
    try {
      const logoPrompt = `${projectDesc || "memecoin style"} coin logo for "${coinName}", small, futuristic, eye-catching design`;
      const logoResponse = await openai.createImage({
        prompt: logoPrompt,
        n: 1,
        size: "256x256"
      });
      const logoUrl = logoResponse.data.data[0].url;

      const logoFetch = await fetch(logoUrl);
      const logoBuffer = await logoFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_LOGO"] = `data:image/png;base64,${Buffer.from(logoBuffer).toString('base64')}`;
    } catch (err) {
      console.error("Logo generation error:", err);
      // fallback
      placeholders["IMAGE_PLACEHOLDER_LOGO"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    // (B) Generate HERO BG
    progressMap[requestId].progress = 60;
    try {
      const bgPrompt = `${projectDesc || "memecoin"} background for a hero section, referencing color palette "${colorPalette}", futuristic, bold, eye-catching`;
      const bgResponse = await openai.createImage({
        prompt: bgPrompt,
        n: 1,
        size: "256x256"
      });
      const bgUrl = bgResponse.data.data[0].url;

      const bgFetch = await fetch(bgUrl);
      const bgBuffer = await bgFetch.arrayBuffer();
      placeholders["IMAGE_PLACEHOLDER_BG"] = `data:image/png;base64,${Buffer.from(bgBuffer).toString('base64')}`;
    } catch (err) {
      console.error("BG generation error:", err);
      // fallback
      placeholders["IMAGE_PLACEHOLDER_BG"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    progressMap[requestId].progress = 80;

    // 5) Replace placeholders in the GPT code
    Object.keys(placeholders).forEach((phKey) => {
      const base64Uri = placeholders[phKey];
      const regex = new RegExp(phKey, 'g');
      siteCode = siteCode.replace(regex, base64Uri);
    });

    progressMap[requestId].progress = 90;

    // 6) Save final code, set status = done
    progressMap[requestId].code = siteCode;
    progressMap[requestId].progress = 100;
    progressMap[requestId].status = 'done';

  } catch (error) {
    console.error("Error in background generation:", error);
    progressMap[requestId].status = 'error';
    progressMap[requestId].progress = 100;
  }
}

/**************************************************
 * Launch the Server
 **************************************************/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KasperCoin Website Builder API running on port ${PORT}`);
});
