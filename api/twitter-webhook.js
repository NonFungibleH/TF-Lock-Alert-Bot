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
  let truncated = text.substring(0, maxLength);
  const lastBreak = Math.max(truncated.lastIndexOf(' '), truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
  if (lastBreak > maxLength * 0.75) truncated = text.substring(0, lastBreak);
  truncated = truncated.trim().replace(/!{2,}/g, '!').replace(/amazing|incredible|exclusive|proven|VIP/gi, '');
  if (truncated.includes(',')) truncated = truncated.replace(/, /g, '\n');
  if (!truncated.match(/[.!?]$/)) truncated += '...';
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
  - Voice of @Hunt3r.exe, a sharp-eyed DeFi tracker sharing practical tips.
  - Plain, confident tone—like chatting with peers over coffee.
  - Use 0–1 emojis if natural (e.g., 🔒 for locks).
  - Limit to 2–3 key points max, use line breaks for readability.
  - No hype words like 'secret', 'amazing', 'proven', 'VIP'.
  - If including a CTA, end naturally with: "${selectedCTA}" as an invite to discuss.
  `;

  const LOCK_TYPES = {
    liquidity_lock: "New liquidity lock on ${lockData.chain.name}. Team’s showing holder trust.",
    token_lock: "Token lock on ${lockData.chain.name}. Solid move for stability.",
    lp_lock: "LP locked on ${lockData.chain.name}. No rug pull risk here.",
    vesting_lock: "Vesting locked on ${lockData.chain.name}. Prevents early dumps."
  };

  const selectedMessage = LOCK_TYPES[lockData.type] || "New lock detected on ${lockData.chain.name}. Good sign for holders.";

  let fullPrompt = `${TONE_TEMPLATE}
Lock Details:
- Chain: ${lockData.chain.name}
- Type: ${lockData.type}
- Source: ${lockData.source}
Message: ${selectedMessage}
Style: Simple fact-based alert about the lock detection
`;
  if (includeCTA) {
    fullPrompt += `\nInclude the CTA at the end to drive to Telegram community.`;
  } else {
    fullPrompt += `\nNo CTA – focus on pure value and information.`;
  }
  return { prompt: fullPrompt, style: "plain", includeCTA };
}

const PROFESSIONAL_CTAS = [
  `Join @Hunt3r.exe on Telegram for more alerts: ${COMMUNITY_LINK}`,
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
        content: "You are @Hunt3r.exe, a sharp-eyed DeFi tracker. Write clear, concise tweets with a casual, expert tone—like sharing tips with peers. Avoid hype. Examples: 'Liquidity lock on Ethereum. 95% LP locked for 6 months. Solid move. 🔒' or 'New lock on BSC—LP secured. No rug risk. Join @Hunt3r.exe on Telegram for more: https://t.co/iEAhyR2PgC'"
      }, {
        role: "user",
        content: prompt
      }],
      max_tokens: 50, // Reduced to enforce brevity
      temperature: 0.6
    });
   
    let tweetText = completion.choices[0].message.content.trim();
    tweetText = tweetText.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    console.log("Generated professional lock alert text:", tweetText);
    console.log("Character length before processing:", tweetText.length);
   
    tweetText = ensureTwitterLimit(tweetText, 275);
    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);
   
    if (tweetText.length > 280) {
      console.error("Tweet still over limit after processing:", tweetText.length);
      return res.status(400).json({ error: "Tweet exceeds character limit after processing" });
    }
   
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
