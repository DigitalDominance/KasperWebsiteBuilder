// backend/services/openaiService.js

const { Configuration, OpenAIApi } = require('openai');

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**
 * Generates website code using OpenAI's GPT-4.
 * @param {string} systemMessage 
 * @param {string} userMessage 
 * @returns {string} Generated website code
 */
async function generateWebsite(systemMessage, userMessage) {
  try {
    const gptResponse = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage }
      ],
      max_tokens: 3500,
      temperature: 0.9
    });

    let siteCode = gptResponse.data.choices[0].message.content.trim();

    // Remove triple backticks if present
    siteCode = siteCode.replace(/```+/g, '');

    return siteCode;
  } catch (error) {
    console.error("Error generating website:", error);
    throw new Error("Failed to generate website.");
  }
}

/**
 * Generates images using OpenAI's DALL-E.
 * @param {string} prompt 
 * @returns {string} Base64 encoded image
 */
async function generateImage(prompt) {
  try {
    const imageResp = await openai.createImage({
      prompt: prompt,
      n: 1,
      size: "256x256"
    });
    const imageUrl = imageResp.data.data[0].url;
    const imageFetch = await fetch(imageUrl);
    const imageBuffer = await imageFetch.arrayBuffer();
    const base64Image = "data:image/png;base64," + Buffer.from(imageBuffer).toString('base64');
    return base64Image;
  } catch (err) {
    console.error("Image generation error:", err);
    // Return a placeholder image in case of failure
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQIW2Nk+M+ACzFEFwoKMvClX6BAsAwAGgGFu6+opmQAAAABJRU5ErkJggg==";
  }
}

module.exports = { generateWebsite, generateImage };
