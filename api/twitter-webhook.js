// api/twitter-webhook.js
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

module.exports = async (req, res) => {
  try {
    console.log("Twitter webhook called:", req.method);
    
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = req.body || {};
    console.log("Webhook body:", JSON.stringify(body, null, 2));

    if (!body.chainId) {
      console.log("No chainId - validation ping");
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    const lockData = detectLock(body);
    console.log("Lock detection result:", lockData);

    if (!lockData) {
      console.log("No lock event detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }

    // 1/5 chance (20%)
    const shouldTweet = Math.random() < 0.05;
    console.log("Should tweet:", shouldTweet);
    
    if (!shouldTweet) {
      return res.status(200).json({ ok: true, note: "Skipped (not in 1/5)" });
    }

    // Generate unique message with OpenAI
    const prompt = `Create a unique, engaging Twitter post about a new liquidity lock detection. Details: Chain=${lockData.chain.name}, Type=${lockData.type}, Source=${lockData.source}, Tx Link=${lockData.explorerLink}. Make it informative, add emojis, and include a call to join our Telegram for more alerts. Keep under 280 chars.`;
    
    console.log("Generating tweet content...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Or gpt-4o for better quality
      messages: [{ role: "user", content: prompt }],
    });

    const tweetText = completion.choices[0].message.content.trim();
    console.log("Generated tweet:", tweetText);

    // Post to Twitter
    console.log("Posting to Twitter...");
    const { data } = await twitterClient.v2.tweet(tweetText);

    console.log(`📤 Tweeted: ${tweetText}`);
    return res.status(200).json({ 
      status: "tweeted", 
      tweetId: data.id,
      content: tweetText
    });
    
  } catch (err) {
    console.error("❌ Twitter webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message, stack: err.stack });
  }
};
