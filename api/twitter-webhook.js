const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const { detectLock } = require("../shared-lock-detection"); // Adjust path
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});
const COMMUNITY_LINK = "https://t.co/iEAhyR2PgC";

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

// Generate professional lock alert prompts with simplified tone
function getLockAlertPrompt(lockData) {
  const includeCTA = Math.random() < 0.4; // 40% chance for CTA, roughly every few tweets
  const selectedCTA = includeCTA ? PROFESSIONAL_CTAS[Math.floor(Math.random() * PROFESSIONAL_CTAS.length)] : '';

  const TONE_TEMPLATE = `
  Write a single tweet under 240 characters about a liquidity lock detection.
  - Plain, confident tone (like an experienced DeFi builder on X).
  - Use 0–1 emojis only if natural (e.g., 🔒 for locks).
  - No hashtags unless essential.
  - No hype words like 'secret', 'amazing', 'proven', 'VIP'.
  - Short sentences or line breaks for readability.
  - If including a CTA, end naturally with: "${selectedCTA}" – make it flow as an invitation to discuss.
  `;

  const LOCK_TYPES = {
    liquidity_lock: "New liquidity lock detected on ${lockData.chain.name}. Project showing commitment to holders.",
    token_lock: "Token lock spotted on ${lockData.chain.name}. Good sign for long-term stability.",
    lp_lock: "LP tokens locked on ${lockData.chain.name}. Team can't rug pull liquidity.",
    vesting_lock: "Vesting schedule locked on ${lockData.chain.name}. Prevents immediate dumps."
  };

  const ALERT_STYLES = [
    "Simple fact-based alert about the lock detection",
    "Brief explanation of why this lock matters for holders", 
    "Quick note about what this means for project trust",
    "Straightforward update on the lock mechanism used"
  ];

  const selectedStyle = ALERT_STYLES[Math.floor(Math.random() * ALERT_STYLES.length)];
  
  let fullPrompt = `${TONE_TEMPLATE}
  
Lock Details:
- Chain: ${lockData.chain.name}
- Type: ${lockData.type}
- Source: ${lockData.source}

Style: ${selectedStyle}
`;

  if (includeCTA) {
    fullPrompt += `\nInclude the CTA at the end to drive to Telegram community.`;
  } else {
    fullPrompt += `\nNo CTA – focus on pure value and information.`;
  }

  return { prompt: fullPrompt, style: "plain", includeCTA };
}

const PROFESSIONAL_CTAS = [
  `Join the Telegram for more alerts: ${COMMUNITY_LINK}`,
  `Chat about locks in our Telegram: ${COMMUNITY_LINK}`,
  `Discuss this lock with us on Telegram: ${COMMUNITY_LINK}`,
  `Get real-time lock alerts in Telegram: ${COMMUNITY_LINK}`,
  `Join 5k+ traders tracking locks: ${COMMUNITY_LINK}`
];

module.exports = async (req, res) => {
  try {
    console.log("Twitter webhook called:", req.method);

    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }
    
    const body = req.body || {};
    console.log("Webhook body received");

    if (!body.chainId) {
      console.log("No chainId - validation ping");
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }
    
    const lockData = detectLock(body);
    console.log("Lock detection result:", lockData ? "Lock detected" : "No lock");

    if (!lockData) {
      console.log("No lock event detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }
    
    // 1/15 chance (6.67%) for lock alert tweets
    const shouldTweet = Math.random() < (1/15);
    console.log("Should tweet lock alert:", shouldTweet, `(1/15 chance = ${(1/15*100).toFixed(1)}%)`);

    if (!shouldTweet) {
      return res.status(200).json({ ok: true, note: "Lock detected but skipped (not selected for tweet)" });
    }

    // Generate professional lock alert tweet
    const { prompt, style, includeCTA } = getLockAlertPrompt(lockData);
    console.log("Generating professional lock alert tweet with style:", style, "CTA:", includeCTA);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are a DeFi expert writing clear, concise tweets. Sound human, straightforward, and helpful like an experienced builder. Avoid hype. Use plain language. Examples: 'Liquidity lock detected on Ethereum. Team locked 95% of LP tokens for 6 months.' or 'New lock on BSC—project can't pull liquidity now. Good sign for holders. Join our Telegram to track more: https://t.co/iEAhyR2PgC'"
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

    console.log("Generated professional lock alert text:", tweetText);
    console.log("Character length before processing:", tweetText.length);

    // Ensure tweet is under character limit
    tweetText = ensureTwitterLimit(tweetText, 275);

    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);
    
    if (tweetText.length > 280) {
      console.error("Tweet still over limit after processing:", tweetText.length);
      return res.status(400).json({ error: "Tweet exceeds character limit after processing" });
    }

    // Post to Twitter
    console.log("Posting professional lock alert to Twitter...");
    const { data } = await twitterClient.v2.tweet(tweetText);

    console.log(`📤 Professional lock alert tweeted (style: ${style}): ${tweetText}`);
    console.log(`🔗 Original transaction: ${lockData.explorerLink}`);

    return res.status(200).json({
      status: "tweeted",
      tweetId: data.id,
      type: "professional_lock_alert",
      style: style,
      includedCTA: includeCTA,
      content: tweetText,
      length: tweetText.length,
      lockData: {
        chain: lockData.chain.name,
        type: lockData.type,
        source: lockData.source,
        txHash: lockData.txHash
      }
    });

  } catch (err) {
    console.error("❌ Twitter webhook error:", {
      message: err.message,
      code: err.code,
      data: err.data,
      status: err.statusCode
    });
    
    return res.status(200).json({
      ok: true,
      error: err.message,
      code: err.code
    });
  }
};
