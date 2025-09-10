const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");

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
  const lastEmoji = truncated.lastIndexOf('🔗');
  
  // Try to cut at a natural break point
  const breakPoint = Math.max(lastPeriod, lastSpace);
  if (breakPoint > maxLength * 0.8) { // If break point is reasonable
    truncated = text.substring(0, breakPoint);
  }
  
  // Ensure we don't cut off important elements like links
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

    // Generate marketing/educational content (not lock alerts)
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
    
    let prompt;
    switch (selectedTopic) {
      case "importance_of_locks":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist explaining why liquidity locks are crucial for DeFi investor due diligence. Mention that I help traders spot trustworthy projects. Include emojis and end with "Join my community for real-time lock alerts: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "red_flags_no_locks":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist warning about the risks of investing in projects without locked liquidity. Explain what could go wrong (rug pulls, exit scams). Include emojis and end with "I share lock alerts to help you avoid these risks: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "how_locks_work":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist explaining in simple terms how liquidity locks protect investors. Mention that locked liquidity means devs can't drain the pool. Include emojis and end with "Follow my community for lock updates: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "dd_checklist":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist sharing a quick DD checklist for DeFi projects (check locks, team transparency, etc.). Position yourself as someone who helps traders with research. Include emojis and end with "Join my community for lock alerts: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "trust_indicators":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist about why projects that lock liquidity are more trustworthy. Explain it shows long-term commitment. Include emojis and end with "I track these signals daily for my community: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "common_scams":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist warning about common DeFi scams and how locked liquidity helps avoid them. Share your expertise. Include emojis and end with "Stay safe - follow my lock alerts: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
      case "community_benefits":
        prompt = `Write a first-person Twitter post as a liquidity lock specialist highlighting the benefits of joining a community focused on lock alerts and DD. Mention real-time notifications and safer investing. Include emojis and end with "Join my community: ${COMMUNITY_LINK}". Keep under 270 characters.`;
        break;
    }

    console.log("Generating tweet content for topic:", selectedTopic);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100, // Limit tokens to help with length control
      temperature: 0.8 // Add some creativity variation
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
      return res.status(400).json({ error: "Tweet exceeds character limit after processing" });
    }

    console.log("Posting to Twitter...");
    const response = await twitterClient.v2.tweet(tweetText);
    const { data } = response;

    console.log(`📤 Marketing tweet posted (topic: ${selectedTopic}): ${tweetText}`);
    return res.status(200).json({ 
      status: "tweeted", 
      tweetId: data.id, 
      type: "marketing",
      topic: selectedTopic,
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
