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

function generateRequestId() {
  return Math.random().toString(36).substr(2, 9);
}

/**************************************************
 * GET /
 **************************************************/
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder with advanced GPT-4o instructions is running!');
});

/**************************************************
 * POST /start-generation
 * Expects:
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
  const requestId = generateRequestId();

  progressMap[requestId] = {
    status: 'in-progress',
    progress: 0,
    code: null
  };

  doWebsiteGeneration(requestId, req.body.userInputs)
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
 * Background Generation Function
 **************************************************/
async function doWebsiteGeneration(requestId, userInputs) {
  try {
    const { coinName, colorPalette, projectDesc } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing 'coinName' or 'colorPalette'.");
    }

    progressMap[requestId].progress = 10;

    // This snippet is used as inspiration for shimmer, gradients, pinned footer, etc.
    // We'll embed it in the system instructions, with no code fences.
    const snippetInspiration = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Shimmer Gradient Demo</title>
  <style>
    body {
      margin: 0; padding: 0; 
      font-family: 'Poppins', sans-serif; 
      background: linear-gradient(135deg, #1f1c2c, #928DAB); 
      color: #fff;
    }
    .shimmer {
      background: linear-gradient(90deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0.1) 100%);
      background-size: 200% 200%;
      animation: shimmerMove 2s infinite;
    }
    @keyframes shimmerMove {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    footer {
      position: absolute; 
      bottom: 0; left: 0; right: 0; 
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="shimmer" style="padding:20px;">
    <h1>Example Shimmer Gradient</h1>
    <p>This is just an example snippet.</p>
  </div>
</body>
</html>
`;

    // GPT system instructions
    const systemMessage = `
You are GPT-4o, an advanced coding AI. Produce a single-page HTML/CSS/JS site (nav, hero, roadmap with timeline progress bars, 3 tokenomics cards, pinned footer) using shimmering effects, gradients, advanced transitions, fully responsive design.

Use snippet below as inspiration for shimmer/gradient/pinned footer. No code fences. No leftover triple backticks:

${snippetInspiration}

Output must contain:
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8"/>
    <title>${coinName}</title>
    <style> ... </style>
  </head>
  <body>
    <!-- Nav with IMAGE_PLACEHOLDER_LOGO, unclickable links -->
    <!-- Hero with IMAGE_PLACEHOLDER_BG, big heading, subheader referencing ${coinName}, ${colorPalette}, ${projectDesc} -->
    <!-- Roadmap: timeline with progress bars -->
    <!-- Tokenomics: exactly 3 cards -->
    <!-- Footer pinned at bottom -->
    <script> ... </script>
  </body>
</html>
No external code fences or triple backticks. Fully responsive, visually appealing with shimmer, gradient, pinned bottom footer, transitions. 
Replace IMAGE_PLACEHOLDER_LOGO and IMAGE_PLACEHOLDER_BG with real images. 
No real links, just visual placeholders (javascript:void(0)). 
Now generate the final code in one block (HTML/CSS/JS combined).
    `;

    progressMap[requestId].progress = 20;

    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: "Produce the single-page code with shimmer, gradient, pinned footer, no code fences." }
      ],
      max_tokens: 3500,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 40;

    // We generate 2 images with DALL·E: LOGO + BG
    const placeholders = {};

    // (A) LOGO
    progressMap[requestId].progress = 50;
    try {
      const logoPrompt = `${projectDesc || "memecoin"} coin logo for "${coinName}", small, futuristic, referencing palette ${colorPalette}, shimmering effect vibe.`;
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
      const bgPrompt = `${projectDesc || "memecoin"} hero background referencing palette "${colorPalette}", futuristic, bold, shimmering/gradient, comedic or edgy vibes.`;
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

  } catch (error) {
    console.error("Error in background generation:", error);
    progressMap[requestId].status = 'error';
    progressMap[requestId].progress = 100;
  }
}

/**************************************************
 * Launch
 **************************************************/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KasperCoin Website Builder API running on port ${PORT} with GPT-4o!`);
});
