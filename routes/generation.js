// backend/routes/generation.js

const express = require('express');
const router = express.Router();
const { generateWebsite, generateImage } = require('../services/openaiService');
const User = require('../models/User');
const sanitizer = require('../utils/sanitizer');

// In-memory progress tracking
const progressMap = {};

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * POST /start-generation
 * Body:
 * {
 *   walletAddress: "UserWalletAddress",
 *   userInputs: {
 *     coinName: "SomeCoin",
 *     colorPalette: "purple and neon-blue",
 *     projectDesc: "futuristic memecoin style"
 *   }
 * }
 */
router.post('/start-generation', async (req, res) => {
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

/**
 * GET /progress?requestId=XYZ
 */
router.get('/progress', (req, res) => {
  const { requestId } = req.query;
  if (!requestId || !progressMap[requestId]) {
    return res.status(400).json({ error: "Invalid or missing requestId" });
  }
  const { status, progress } = progressMap[requestId];
  return res.json({ status, progress });
});

/**
 * GET /result?requestId=XYZ
 */
router.get('/result', (req, res) => {
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

/**
 * GET /export?requestId=XYZ&type=full|wordpress
 */
router.get('/export', (req, res) => {
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
});

/**
 * Helper function to sanitize filenames
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/**
 * Background website generation function
 */
async function doWebsiteGeneration(requestId, userInputs, user) {
  try {
    const { coinName, colorPalette, projectDesc } = userInputs || {};
    if (!coinName || !colorPalette) {
      throw new Error("Missing 'coinName' or 'colorPalette'.");
    }

    progressMap[requestId].progress = 10;

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
`;

    progressMap[requestId].progress = 20;

    // Generate website code
    const userMessage = "Generate the single-file site now, strictly following colorPalette, non-sticky nav/footer, 3 token cards, vertical roadmap timeline, no leftover code fences. Beautiful styling. Responsive. Modern.";
    let siteCode = await generateWebsite(systemMessage, userMessage);
    progressMap[requestId].progress = 40;

    // Generate images with DALL·E
    const placeholders = {};

    // (A) LOGO
    progressMap[requestId].progress = 50;
    const logoPrompt = `logo for a memecoin called "${coinName}", color palette "${colorPalette}", project vibe: ${projectDesc}, small eye-catching design. Must match coin name.`;
    const logoImage = await generateImage(logoPrompt);
    placeholders["IMAGE_PLACEHOLDER_LOGO"] = logoImage;

    // (B) BG
    progressMap[requestId].progress = 60;
    const bgPrompt = `hero background for a memecoin called "${coinName}", color palette "${colorPalette}", referencing ${projectDesc}, advanced gradient or shimmer, futuristic. Must match coin name and color vibe.`;
    const bgImage = await generateImage(bgPrompt);
    placeholders["IMAGE_PLACEHOLDER_BG"] = bgImage;

    progressMap[requestId].progress = 80;

    // Replace placeholders
    Object.keys(placeholders).forEach(phKey => {
      const base64Uri = placeholders[phKey];
      const regex = new RegExp(phKey, 'g');
      siteCode = siteCode.replace(regex, base64Uri);
    });

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

module.exports = router;
