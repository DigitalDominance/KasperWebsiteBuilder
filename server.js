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
  res.send('KasperCoin Website Builder with Progress Tracking is running (GPT-4o)!');
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
    const { coinName, colorPalette, projectDesc } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing 'coinName' or 'colorPalette'.");
    }

    progressMap[requestId].progress = 10;

    // 1) GPT-4o system instructions
    const systemMessage = `
      You are a coding AI specialized in building extremely modern, visually stunning,
      single-page memecoin websites with advanced styling.

      ### SCOPE:
      - Produce THREE logical "files": HTML, CSS, and JS—but combine them into ONE final output.
      - This means your final output must have:
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8" />
          <title>${coinName}</title>
          <style>
            /* Place all advanced CSS here */
          </style>
        </head>
        <body>
          <!-- Nav, Splash, Roadmap, Tokenomics, Footer in that order -->
          <!-- Use placeholders for images:
               IMAGE_PLACEHOLDER_LOGO (nav)
               IMAGE_PLACEHOLDER_BG   (hero) -->

          <script>
            // Place any JS needed (e.g., FAQ accordion logic) here
          </script>
        </body>
        </html>

      ### REQUIRED SECTIONS (in order):
      1) NAV (top): left = logo (IMAGE_PLACEHOLDER_LOGO), right = nav links (Home, Roadmap, Tokenomics, FAQ) - but they do nothing.
      2) SPLASH (hero) below nav:
         - Fullwidth background image (IMAGE_PLACEHOLDER_BG).
         - Big heading with coin name "${coinName}".
         - A short subheader referencing color palette "${colorPalette}" and project vibe "${projectDesc}".
      3) ROADMAP section.
      4) TOKENOMICS section.
      5) FOOTER at bottom (even if content is short).
         - Memecoin disclaimers, social links, etc.

      ### STYLING/ANIMATION REQUIREMENTS:
      - Minimal or no external libraries. Just advanced CSS (keyframes, transitions).
      - Fully responsive. 
      - Use modern gradient backgrounds, frosted glass, or bold neon if it suits the palette.
      - The final code must be visually appealing and not basic.
      - The nav links do NOT navigate anywhere. They are purely visual.

      ### OUTPUT:
      - Provide one single block of HTML with <style> and <script> included inline.
      - No additional commentary, no separate files. Just the code.
    `;

    progressMap[requestId].progress = 20;

    // 2) Call GPT-4o
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o", // custom or fine-tuned GPT-4 model
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: "Generate the advanced single-page site code now. " }
      ],
      max_tokens: 3000,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 40;

    // 3) Generate two DALL·E images
    //    placeholders: IMAGE_PLACEHOLDER_LOGO, IMAGE_PLACEHOLDER_BG
    const placeholders = {};

    // (A) LOGO
    progressMap[requestId].progress = 50;
    try {
      const logoPrompt = `${projectDesc || "memecoin"} coin logo for "${coinName}", small, futuristic, eye-catching design, referencing palette ${colorPalette}`;
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
      placeholders["IMAGE_PLACEHOLDER_LOGO"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    // (B) HERO BG
    progressMap[requestId].progress = 60;
    try {
      const bgPrompt = `${projectDesc || "memecoin"} hero background referencing color palette "${colorPalette}", futuristic, bold, eye-catching`;
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
      placeholders["IMAGE_PLACEHOLDER_BG"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
    }

    progressMap[requestId].progress = 80;

    // 4) Replace placeholders in the GPT code
    Object.keys(placeholders).forEach((phKey) => {
      const base64Uri = placeholders[phKey];
      const regex = new RegExp(phKey, 'g');
      siteCode = siteCode.replace(regex, base64Uri);
    });

    progressMap[requestId].progress = 90;

    // 5) Save final code, set status = done
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
  console.log(`KasperCoin Website Builder API running on port ${PORT} (GPT-4o)!`);
});
