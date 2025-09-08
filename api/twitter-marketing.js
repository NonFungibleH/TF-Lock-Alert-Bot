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
    console.log("Request method:", req.method);
    console.log("Auth header:", req.headers.authorization);
    console.log("Bearer token set:", process.env.TWITTER_BEARER_TOKEN ? "YES" : "NO");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;
    const expectedAuth = "Bearer " + process.env.TWITTER_BEARER_TOKEN;

    if (!authHeader || authHeader !== expectedAuth) {
      console.log("Authorization failed");
      console.log("Received:", authHeader);
      console.log("Expected:", expectedAuth ? "Bearer [TOKEN]" : "NOT SET");
      return res.status(403).json({ error: "Unauthorized" });
    }

    const type = Math.random() < 0.5 ? "marketing" : "educational";

    let prompt = type === "marketing"
      ? "Create a promotional Twitter post explaining our Telegram group's lock alert signals. Goal: Drive users to join the Telegram channel. Make it engaging, use emojis, mention benefits like real-time alerts on liquidity locks. Include a link to the Telegram (replace with actual: t.me/yourgroup). Ensure the response is under 280 characters."
      : "Create an educational Twitter post about the importance of liquidity locks in due diligence (DD) for crypto projects. Explain why they matter, risks without them, tips. Use simple language, emojis. End with a call to follow for more tips and join our Telegram for alerts. Ensure the response is under 280 characters.";

    console.log("Generating tweet content...");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    const tweetText = completion.choices[0].message.content.trim();
    console.log("Tweet length:", tweetText.length);
    console.log("Generated tweet:", tweetText);

    if (tweetText.length > 280) {
      throw new Error("Tweet exceeds 280 characters");
    }

    console.log("Posting to Twitter...");
    console.log("Twitter client config:", {
      hasApiKey: !!process.env.TWITTER_API_KEY,
      hasApiSecret: !!process.env.TWITTER_API_SECRET,
      hasAccessToken: !!process.env.TWITTER_ACCESS_TOKEN,
      hasAccessSecret: !!process.env.TWITTER_ACCESS_SECRET
    });

    // Post the tweet
    const { data } = await twitterClient.v2.tweet(tweetText);

    // Check rate limit status
    const rateLimit = await twitterClient.v2.get("https://api.twitter.com/2/application/rate_limit_status");
    console.log("Rate Limit Status:", rateLimit.data.resources.tweets || "No rate limit data");

    console.log(`📤 ${type} Tweeted: ${tweetText}`);
    return res.status(200).json({ status: "tweeted", tweetId: data.id, type, content: tweetText });
  } catch (err) {
    console.error("Twitter API Error:", {
      code: err.code,
      message: err.message,
      data: err.data,
      headers: err.headers,
      status: err.statusCode,
      allErrors: err.allErrors
    }, err.stack);
    return res.status(500).json({ error: "Twitter API request failed", code: err.code, details: err.data, stack: err.stack });
  }
};
