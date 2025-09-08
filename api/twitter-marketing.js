const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST" || !req.headers.authorization || req.headers.authorization !== "Bearer " + process.env.TWITTER_BEARER_TOKEN) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const type = Math.random() < 0.5 ? "marketing" : "educational";
    let prompt = type === "marketing"
      ? "Create a promotional Twitter post explaining our Telegram group's lock alert signals. Goal: Drive users to join the Telegram channel. Make it engaging, use emojis, mention benefits like real-time alerts on liquidity locks. Include a link to the Telegram (replace with actual: t.me/yourgroup). Under 280 chars."
      : "Create an educational Twitter post about the importance of liquidity locks in due diligence (DD) for crypto projects. Explain why they matter, risks without them, tips. Use simple language, emojis. End with a call to follow for more tips and join our Telegram for alerts. Under 280 chars.";

    const completion = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] });
    const tweetText = completion.choices[0].message.content.trim();

    const { data } = await twitterClient.v2.tweet(tweetText);
    console.log(`📤 ${type} Tweeted: ${tweetText}`);
    return res.status(200).json({ status: "tweeted", tweetId: data.id, type });
  } catch (err) {
    console.error("❌ Marketing post error:", err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
