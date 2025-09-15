const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});
const COMMUNITY_LINK = "https://t.co/iEAhyR2PgC"; // Replace with your actual Telegram link if different

// Helper function to ensure tweet is under 280 characters
function ensureTwitterLimit(text, maxLength = 275) {
  if (text.length <= maxLength) return text;

  // Find the last complete sentence or phrase before the limit
  let truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  const lastExclamation = truncated.lastIndexOf('!');
  const lastQuestion = truncated.lastIndexOf('?');

  // Try to cut at a natural break point
  const breakPoint = Math.max(lastPeriod, lastExclamation, lastQuestion, lastSpace);
  if (breakPoint > maxLength * 0.75) {
    truncated = text.substring(0, breakPoint);
  }

  // Clean up and remove hype
  truncated = truncated.trim().replace(/!{2,}/g, '!').replace(/amazing|incredible|exclusive|proven|VIP/gi, '');
  if (truncated.includes(',')) truncated = truncated.replace(/, /g, '\n'); // Optional line breaks for readability
  if (!truncated.match(/[.!?]$/)) truncated += '...';

  // Ensure CTA isn't cut off if present
  if (truncated.includes('Telegram') && !truncated.endsWith(COMMUNITY_LINK.replace('https://t.co/', ''))) {
    truncated = truncated.split('Telegram')[0].trim() + '...';
  }

  return truncated;
}

// Generate professional tweet prompts with simplified tone
function getTweetPrompt(topic) {
  const includeCTA = Math.random() < 0.4; // 40% chance for CTA, roughly every few tweets
  const selectedCTA = includeCTA ? PROFESSIONAL_CTAS[Math.floor(Math.random() * PROFESSIONAL_CTAS.length)] : '';

  const TONE_TEMPLATE = `
  Write a single tweet under 240 characters.
  - Plain, confident tone (like an experienced DeFi builder on X).
  - Use 0–1 emojis only if natural (e.g., 🔒 for locks).
  - No hashtags unless essential.
  - No hype words like 'secret', 'amazing', 'proven', 'VIP'.
  - Short sentences or line breaks for readability.
  - If including a CTA, end naturally with: "${selectedCTA}" – make it flow as an invitation to discuss.
  `;

  const TOPIC_GUIDANCE = {
    importance_of_locks: "Explain why locking liquidity builds trust in DeFi projects.",
    red_flags_no_locks: "Warn about red flags in projects without locked liquidity.",
    how_locks_work: "Simply describe how liquidity locks work.",
    dd_checklist: "Share a basic due diligence checklist for DeFi investments.",
    trust_indicators: "Highlight reliable trust indicators to check in DeFi.",
    common_scams: "Point out common DeFi scams to avoid.",
    community_benefits: "Explain benefits of collaborating in a DeFi community."
  };

  let fullPrompt = `${TONE_TEMPLATE}\nTopic: ${topic}.\n${TOPIC_GUIDANCE[topic]}`;
  if (includeCTA) {
    fullPrompt += `\nInclude the CTA at the end to drive to Telegram community.`;
  } else {
    fullPrompt += `\nNo CTA – focus on pure value.`;
  }

  return { prompt: fullPrompt, style: "plain", includeCTA };
}

const PROFESSIONAL_CTAS = [
  `Join the Telegram for more tips: ${COMMUNITY_LINK}`,
  `Chat in our Telegram community: ${COMMUNITY_LINK}`,
  `Discuss DeFi alerts with us on Telegram: ${COMMUNITY_LINK}`,
  `Get real-time insights in Telegram: ${COMMUNITY_LINK}`,
  `Join 5k+ traders in our Telegram: ${COMMUNITY_LINK}`
];

module.exports = async (req, res) => {
  try {
    console.log("Request method:", req.method);
    console.log("Auth header:", req.headers.authorization);
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const expectedAuth = "Bearer " + process.env.TWITTER_BEARER_TOKEN;
    if (!authHeader || authHeader !== expectedAuth) {
      console.log("Authorization failed");
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Generate professional marketing content
    const topics = [
      "importance_of_locks",
      "red_flags_no_locks",
      "how_locks_work",
      "dd_checklist",
      "trust_indicators",
      "common_scams",
      "community_benefits"
    ];

    const selectedTopic = topics[Math.floor(Math.random() * topics.length)];
    const { prompt, style, includeCTA } = getTweetPrompt(selectedTopic);

    console.log("Generating professional tweet content for topic:", selectedTopic, "style:", style, "CTA:", includeCTA);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are a DeFi expert writing clear, concise tweets. Sound human, straightforward, and helpful like an experienced builder. Avoid hype. Use plain language. Examples: 'Liquidity locks aren’t flashy—they’re trust. If a project won’t lock, think twice.' or 'Spotting red flags in DeFi? No liquidity lock is a big one. Join our Telegram to share experiences: https://t.co/iEAhyR2PgC'"
      }, {
        role: "user",
        content: prompt
      }],
      max_tokens: 60,
      temperature: 0.6
    });

    let tweetText = completion.choices[0].message.content.trim();

    // Clean up the response
    tweetText = tweetText.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');

    console.log("Generated professional tweet text:", tweetText);
    console.log("Character length before processing:", tweetText.length);

    // Ensure tweet is under character limit
    tweetText = ensureTwitterLimit(tweetText, 275);

    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);
    if (tweetText.length > 280) {
      console.error("Tweet still over limit after processing:", tweetText.length);
      return res.status(400).json({ error: "Tweet exceeds character limit after processing" });
    }

    console.log("Posting professional tweet to Twitter...");
    const response = await twitterClient.v2.tweet(tweetText);
    const { data } = response;
    console.log(`📤 Professional marketing tweet posted (topic: ${selectedTopic}, style: ${style}): ${tweetText}`);
    return res.status(200).json({
      status: "tweeted",
      tweetId: data.id,
      type: "professional_marketing",
      topic: selectedTopic,
      style: style,
      includedCTA: includeCTA,
      content: tweetText,
      length: tweetText.length
    });
  } catch (err) {
    console.error("Twitter API Error:", {
      code: err.code,
      message: err.message,
      data: err.data,
      status: err.statusCode
    });
    return res.status(500).json({
      error: "Twitter API request failed",
      code: err.code,
      details: err.data
    });
  }
};
