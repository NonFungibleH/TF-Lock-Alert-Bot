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
function ensureTwitterLimit(text, maxLength = 275) { // Use 275 to be safe
  if (text.length <= maxLength) return text;
  
  // Find the last complete sentence or phrase before the limit
  let truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const lastPeriod = truncated.lastIndexOf('.');
  
  // Try to cut at a natural break point
  const breakPoint = Math.max(lastPeriod, lastSpace);
  if (breakPoint > maxLength * 0.8) { // If break point is reasonable
    truncated = text.substring(0, breakPoint);
  }
  
  // Ensure we don't cut off the community link
  if (text.includes(COMMUNITY_LINK) && !truncated.includes(COMMUNITY_LINK)) {
    // Prioritize keeping the community link
    const linkStart = text.indexOf(COMMUNITY_LINK);
    const beforeLink = text.substring(0, linkStart).trim();
    const availableSpace = maxLength - COMMUNITY_LINK.length - 1; // -1 for space
    if (beforeLink.length > availableSpace) {
      const trimmed = beforeLink.substring(0, availableSpace - 3) + "...";
      truncated = `${trimmed} ${COMMUNITY_LINK}`;
    } else {
      truncated = `${beforeLink} ${COMMUNITY_LINK}`;
    }
  }
  
  return truncated;
}

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

    // Generate lock alert tweet
    const prompt = `Write a first-person Twitter post as a liquidity lock specialist announcing a new lock detection. 

Details:
- Chain: ${lockData.chain.name}
- Lock Type: ${lockData.type}  
- Source: ${lockData.source}

Write as if you personally detected this lock. Be excited but professional. Include relevant emojis (🔒, 🚨, ⚡, etc.). 

Mention that this is just one of many alerts and users should join your community for all updates: ${COMMUNITY_LINK}

Do NOT include the transaction link in the tweet (save space for community link).

Keep under 270 characters total. Write in first person as the specialist who found this.`;

    console.log("Generating lock alert tweet...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.7
    });

    let tweetText = completion.choices[0].message.content.trim();
    
    // Remove any quote marks that might be added
    tweetText = tweetText.replace(/^["']|["']$/g, '');
    
    console.log("Generated tweet text:", tweetText);
    console.log("Character length before processing:", tweetText.length);

    // Ensure tweet is under character limit
    tweetText = ensureTwitterLimit(tweetText);
    
    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);

    if (tweetText.length > 280) {
      console.error("Tweet still over limit after processing:", tweetText.length);
      return res.status(500).json({ error: "Tweet exceeds character limit after processing" });
    }

    // Post to Twitter
    console.log("Posting lock alert to Twitter...");
    const { data } = await twitterClient.v2.tweet(tweetText);
    
    console.log(`📤 Lock Alert Tweeted: ${tweetText}`);
    console.log(`🔗 Original transaction: ${lockData.explorerLink}`);
    
    return res.status(200).json({ 
      status: "tweeted", 
      tweetId: data.id,
      type: "lock_alert",
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
