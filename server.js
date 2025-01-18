require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');
const fetch = require('node-fetch'); // used for fetching DALL·E images

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
  apiKey: process.env.OPENAI_API_KEY, // Must be a valid key with access to "gpt-4o-mini" or your custom model
});
const openai = new OpenAIApi(configuration);

/**
 * GET /
 * Simple test endpoint
 */
app.get('/', (req, res) => {
  res.send('KasperCoin Website Builder API is running!');
});

/**
 * POST /generate-website-code
 *
 * userInputs:
 *  - coinName
 *  - colorPalette
 *  - imagePrompts (array of strings)
 */
app.post('/generate-website-code', async (req, res) => {
  try {
    const { userInputs } = req.body;
    if (!userInputs || !userInputs.coinName || !userInputs.colorPalette) {
      return res.status(400).json({ error: "Please provide 'coinName' and 'colorPalette' in userInputs." });
    }

    const numberOfPlaceholders = userInputs.imagePrompts?.length || 0;

    // We'll embed your old instructions as a single "system" message
    const systemInstructions = `
      You are a coding AI specialized in building fun, memecoin-style websites,
      strongly inspired by kaspercoin.net. The user wants a fully responsive
      single-page site for a coin/project called "${userInputs.coinName}" 
      using a ${userInputs.colorPalette} color scheme.

      The layout must include:
      1. A navigation bar (top of page).
      2. A splash (hero) section highlighting "${userInputs.coinName}" with a big headline and one image placeholder.
      3. A tokenomics section explaining the supply or any key stats.
      4. A roadmap section with milestone-like items.
      5. A FAQ section for common questions.
      6. A footer that includes:
         - Links to X (Twitter) and Telegram
         - Normal footer content (copyright)
         - Possibly a "Join the community" or typical memecoin vibe.

      Also include any other normal memecoin elements (like fun slogans or branding lines).
      Use placeholders in the form:
      <img src="IMAGE_PLACEHOLDER_{n}" alt="image" />
      for each image, e.g. IMAGE_PLACEHOLDER_1, IMAGE_PLACEHOLDER_2, etc.

      Requirements:
      - HTML, CSS (and minimal JS if needed) in one file.
      - Must be fully responsive across all devices.
      - Well-commented code.
      - There should be ${numberOfPlaceholders} placeholders total (match the user's requested images).
      
      Output only valid HTML/CSS/JS, with no extra explanation.
    `;

    // We make a ChatCompletion call to "gpt-4o-mini" (custom model)
    // If you don't actually have that model, you'll get an error from OpenAI
    const chatResponse = await openai.createChatCompletion({
      model: "gpt-4o-mini", // custom or fine-tuned model name
      messages: [
        {
          role: "system",
          content: systemInstructions
        },
        // Optionally, add a user message if you want more context or direct user input:
        {
          role: "user",
          content: "Generate the website code now."
        }
      ],
      max_tokens: 2000,
      temperature: 0.8
    });

    // The code is in the "content" of the assistant's message
    let generatedCode = chatResponse.data.choices[0].message.content.trim();

    // 2) DALL·E image generation + base64 embedding
    const imageUrls = [];
    if (Array.isArray(userInputs.imagePrompts) && userInputs.imagePrompts.length > 0) {
      for (let i = 0; i < userInputs.imagePrompts.length; i++) {
        const promptDescription = userInputs.imagePrompts[i];
        const finalImagePrompt = `${promptDescription}, in a crypto memecoin style, referencing kaspercoin.net aesthetics, trending on artstation, 4k`;

        try {
          const imageResponse = await openai.createImage({
            prompt: finalImagePrompt,
            n: 1,
            size: "512x512"
          });
          const dallEUrl = imageResponse.data.data[0].url;

          // Convert to base64
          const imageFetch = await fetch(dallEUrl);
          const imageBuffer = await imageFetch.arrayBuffer();
          const base64Data = Buffer.from(imageBuffer).toString('base64');
          const dataUri = `data:image/png;base64,${base64Data}`;
          imageUrls.push(dataUri);

        } catch (err) {
          console.error("Error generating/fetching image:", err);
          // fallback
          imageUrls.push("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAAAwCAYAAABLWConAAAAAElFTkSuQmCC");
        }
      }
    }

    // 3) Replace IMAGE_PLACEHOLDER_n with actual base64 URIs
    imageUrls.forEach((base64Uri, i) => {
      const placeholder = `IMAGE_PLACEHOLDER_${i+1}`;
      const regex = new RegExp(placeholder, 'g');
      generatedCode = generatedCode.replace(regex, base64Uri);
    });

    // Return final HTML code
    return res.json({ code: generatedCode });

  } catch (error) {
    console.error("Error in /generate-website-code:", error);
    res.status(500).json({ error: "Something went wrong generating the website." });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KasperCoin Website Builder API running on port ${PORT}`);
});
