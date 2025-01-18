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
 * In-Memory Progress & Results Storage
 **************************************************/
const progressMap = {}; 
// Structure like:
// progressMap[requestId] = {
//   status: 'in-progress' | 'done' | 'error',
//   progress: 0 to 100,
//   code: null or the final HTML
// };

/**
 * Helper function to generate a random unique requestId.
 * In production, you might use a library like uuid.
 */
function generateRequestId() {
  return Math.random().toString(36).substr(2, 9); 
}

/**************************************************
 * GET / 
 * Simple test
 **************************************************/
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder with Progress Tracking is running!');
});

/**************************************************
 * POST /start-generation
 * Starts the website generation process, returns { requestId }
 **************************************************/
app.post('/start-generation', async (req, res) => {
  // 1) Generate a unique ID for this request
  const requestId = generateRequestId();

  // 2) Initialize progress data
  progressMap[requestId] = {
    status: 'in-progress',
    progress: 0,
    code: null
  };

  // 3) Kick off the background generation
  //    We'll do it asynchronously so we can immediately return requestId.

  // We do NOT await here; instead we call an async function that updates progress in the background.
  doWebsiteGeneration(requestId, req.body.userInputs)
    .catch(err => {
      console.error("Background generation error:", err);
      progressMap[requestId].status = 'error';
      progressMap[requestId].progress = 100;
    });

  // 4) Immediately return the requestId so the front-end can start polling
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
 * Returns { code }
 **************************************************/
app.get('/result', (req, res) => {
  const { requestId } = req.query;
  if (!requestId || !progressMap[requestId]) {
    return res.status(400).json({ error: "Invalid or missing requestId" });
  }

  const { status, code } = progressMap[requestId];
  if (status !== 'done') {
    return res.status(400).json({ error: "Not finished or error" });
  }
  return res.json({ code });
});

/**************************************************
 * The Background Worker Function
 **************************************************/
async function doWebsiteGeneration(requestId, userInputs) {
  try {
    const { coinName, colorPalette, imagePrompts } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing coinName or colorPalette");
    }

    // 1) Update progress to 10% (parsing inputs)
    progressMap[requestId].progress = 10;

    // 2) Build your GPT prompt for the site code. We'll use chatCompletion (gpt-3.5-turbo) for example.
    const messages = [
      {
        role: "system",
        content: `
          You are a coding AI specialized in building fun, memecoin-style websites,
          strongly inspired by kaspercoin.net. The user wants a fully responsive
          single-page site for a coin/project called "${coinName}"
          using a ${colorPalette} color scheme.

          The layout must include:
          1. A navigation bar (top of page).
          2. A splash (hero) section highlighting "${coinName}" with a big headline and one image placeholder.
          3. A tokenomics section.
          4. A roadmap section.
          5. A FAQ section.
          6. A footer (links to X, Telegram, etc.)

          Use placeholders in the form: IMAGE_PLACEHOLDER_{n} for images.
          We expect ${imagePrompts?.length || 0} placeholders total.

          Output only valid HTML/CSS/JS in one file, no extra explanation.
        `
      },
      {
        role: "user",
        content: "Generate the website now."
      }
    ];

    progressMap[requestId].progress = 20;

    // 3) Call GPT
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: 1000, 
      temperature: 0.8
    });
    const siteCode = gptResponse.data.choices[0].message.content.trim();
    progressMap[requestId].progress = 50;

    // 4) Generate images with DALL·E (256x256 placeholders)
    //    If there's none, skip
    const placeholders = [];
    if (Array.isArray(imagePrompts) && imagePrompts.length > 0) {
      for (let i = 0; i < imagePrompts.length; i++) {
        progressMap[requestId].progress = 50 + Math.floor((i / imagePrompts.length) * 30);

        const promptDesc = imagePrompts[i];
        const finalImagePrompt = `${promptDesc}, in a crypto memecoin style, referencing kaspercoin.net aesthetics, bright colors`;
        try {
          const imageResp = await openai.createImage({
            // Omitting "model" so it uses the default DALL·E
            prompt: finalImagePrompt,
            n: 1,
            size: "256x256"
          });
          const dallEUrl = imageResp.data.data[0].url;

          // Convert to base64
          const imageFetch = await fetch(dallEUrl);
          const imageBuffer = await imageFetch.arrayBuffer();
          const base64Data = Buffer.from(imageBuffer).toString('base64');
          const dataUri = `data:image/png;base64,${base64Data}`;

          placeholders.push(dataUri);
        } catch (err) {
          console.error("DALL·E error:", err);
          placeholders.push("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==");
        }
      }
    }

    progressMap[requestId].progress = 80;

    // 5) Replace the placeholders in the site code
    let finalCode = siteCode;
    placeholders.forEach((base64Uri, index) => {
      const placeholder = `IMAGE_PLACEHOLDER_${index + 1}`;
      const regex = new RegExp(placeholder, 'g');
      finalCode = finalCode.replace(regex, base64Uri);
    });

    progressMap[requestId].progress = 90;

    // 6) Save final code, progress = 100, status = done
    progressMap[requestId].code = finalCode;
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
