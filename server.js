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
  res.send('KasperCoin Website Builder with refined GPT-4o instructions is running!');
});

/**************************************************
 * POST /start-generation
 * Expects:
 * {
 *   userInputs: {
 *     coinName: "SomeCoin",
 *     colorPalette: "purple and neon-blue",
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

    // Updated system instructions to enforce:
    // 1) Strict usage of user colorPalette in gradients
    // 2) Non-sticky nav and footer
    // 3) Images must relate to coinName + projectDesc
    // 4) Tokenomics heading with 3 cards below it (vertical)
    // 5) Roadmap is a timeline w/ progress bars, also vertical
    // 6) Must see the gradient from colorPalette
    // 7) No code fences leftover

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

    const systemMessage = `
You are a website building ai, the best of them all. 
Produce a single-page highly advanced beautiful HTML/CSS/JS site based on kaspercoin.net with:
1) modern animated Non-sticky nav (top), containing IMAGE_PLACEHOLDER_LOGO on left, unclickable links (Home, Roadmap, Tokenomics, etc.) on right.
2) modern beautiful Hero/splash below nav, using a strong gradient background derived from "${colorPalette}" or a "background: linear-gradient(...)" with those colors. Then place IMAGE_PLACEHOLDER_BG as a decorative background or element. 
   - Big heading = coinName: "${coinName}"
   - subheading referencing projectDesc: "${projectDesc}"
   - No sticky
3) Roadmap: vertical timeline or steps, each with a small progress bar. use placeholder content.
4) Tokenomics: heading, then 3 cards laid out horizontally. nice clean animations and crisp gradients.
5) Footer at bottom (non-sticky), disclaimers, IMAGE_PLACEHOLDER_LOGO etc. 
   - Must appear at end of page content (not pinned/sticky).
6) Use advanced styling: shimmer, transitions, your colorPalette for gradients. Fully desktop and mobile responsive.
   - Absolutely incorporate the colorPalette in the main backgrounds or sections
7) Images must relate to coinName & projectDesc (and used in DALL·E prompts).
8) No leftover code fences or triple backticks. 
9) The snippet below is partial inspiration:

${snippetInspiration}

Now generate the final code in ONE file: 
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
make sure to include all the final beautiful html css js. quality is the most important thing`;

    progressMap[requestId].progress = 20;

    const gptResponse = await openai.createChatCompletion({
      model: "o1-mini",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: "Generate the single-file site now, strictly following colorPalette, non-sticky nav/footer, 3 token cards, vertical roadmap timeline, no leftover code fences. beautiful styling. responsive. modern" }
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
      const logoPrompt = `logo for a memecoin called "${coinName}", color palette "${colorPalette}", project vibe: ${projectDesc}, small eye-catching design, not sticky. Must match coin name.`;
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
  console.log(`KasperCoin Website Builder API running on port ${PORT}, GPT-4o!`);
});
