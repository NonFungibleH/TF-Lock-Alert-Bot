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

  // Clean up any trailing punctuation or spaces
  truncated = truncated.trim();
  if (!truncated.match(/[.!?]$/)) {
    truncated += '...';
  }

  // Ensure we don't cut off the community link
  if (text.includes(COMMUNITY_LINK) && !truncated.includes(COMMUNITY_LINK)) {
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

// Professional copywriting hooks and power words
const COPYWRITING_HOOKS = {
  curiosity: ["Why", "What", "How", "This", "Secret", "The truth about", "What nobody tells you about"],
  urgency: ["Last chance", "Today only", "Don't miss", "Time-sensitive", "Act now", "Limited time"],
  authority: ["Experts reveal", "Industry leaders", "Proven strategy", "Research shows", "Data confirms"],
  exclusivity: ["Exclusive", "Members only", "VIP access", "Insider", "Behind the scenes"],
  benefit: ["Simple", "Easy", "Fast", "Effective", "Powerful", "Game-changing", "Revolutionary"],
  warning: ["Warning", "Alert", "Danger", "Avoid", "Don't make this mistake", "Critical error"],
  social_proof: ["Join 10,000+", "Trusted by", "Used by", "Recommended by", "Thousands are using"],
  news: ["Breaking", "Announcing", "Finally", "It's happening", "Major update", "New discovery"]
};
const POWER_WORDS = ["amazing", "incredible", "shocking", "breakthrough", "exclusive", "secret", "proven", "ultimate", "essential", "critical"];

// Generate professional tweet prompt for lock alerts
function getLockAlertPrompt(lockData) {
  const styles = [
    "curiosity_hook",
    "urgency_driven",
    "authority_based",
    "warning_alert",
    "social_proof",
    "news_format",
    "question_engagement",
    "benefit_focused"
  ];

  const selectedStyle = styles[Math.floor(Math.random() * styles.length)];
  const includeCTA = Math.random() < 0.3; // 30% chance for CTA

  const professionalPrompts = {
    curiosity_hook: `Write a curiosity-driven tweet starting with 'Why' or 'What' announcing a new liquidity lock detection on ${lockData.chain.name}. Use power words like 'secret' or 'hidden'. Make readers want to learn more.`,
    urgency_driven: `Write an urgent tweet about a new lock detection on ${lockData.chain.name} using 'Don't miss' or 'Time-sensitive'. Create FOMO without being overly dramatic.`,
    authority_based: `Write an authoritative tweet about a lock detection on ${lockData.chain.name} starting with 'Research shows' or 'Data confirms'. Sound like an expert sharing insider knowledge.`,
    warning_alert: `Write a warning tweet about a new lock detection on ${lockData.chain.name} using 'Alert:' or 'Critical update:' as the hook.`,
    social_proof: `Write a tweet using social proof about a lock detection on ${lockData.chain.name}. Reference community size or widespread adoption.`,
    news_format: `Write a news-style tweet about a lock detection on ${lockData.chain.name} using 'Breaking:' or 'Update:' as the opener.`,
    question_engagement: `Write an engaging question about a lock detection on ${lockData.chain.name} that can't be answered with yes/no. Make readers want to share their experience.`,
    benefit_focused: `Write a benefit-driven tweet about a lock detection on ${lockData.chain.name} using 'simple' or 'proven' to highlight reliability.`
  };

  let fullPrompt = `Write a first-person Twitter post as a liquidity lock specialist announcing a new lock detection.
Details:
- Chain: ${lockData.chain.name}
- Lock Type: ${lockData.type}
- Source: ${lockData.source}
${professionalPrompts[selectedStyle]}
Apply these professional Twitter tactics:
1) Keep it concise but impactful - aim for 200-240 characters
2) Use power words naturally (amazing, proven, secret, exclusive, critical)
3) Create curiosity gaps that make people want to learn more
4) Write in active voice with confident, authoritative tone
5) Use 1-2 relevant emojis strategically (🔒, 🚨, ⚡, not at the end)
6) Appeal to emotions - make it feel urgent, exclusive, or valuable
7) Sound like a professional marketer who knows copywriting
8) Avoid repetitive phrases and corporate jargon
9) Make every word count - no filler or fluff
`;

  if (includeCTA) {
    const professionalCTAs = [
      `📚 Deep dive: ${COMMUNITY_LINK}`,
      `🔍 Full analysis: ${COMMUNITY_LINK}`,
      `💎 VIP insights: ${COMMUNITY_LINK}`,
      `⚡ Real-time alerts: ${COMMUNITY_LINK}`,
      `🎯 Join 5,000+ smart traders: ${COMMUNITY_LINK}`
    ];
    const selectedCTA = professionalCTAs[Math.floor(Math.random() * professionalCTAs.length)];
    fullPrompt += `10) End with this professional CTA: "${selectedCTA}"`;
  } else {
    fullPrompt += `10) NO call-to-action or links - focus purely on delivering value`;
  }

  return { prompt: fullPrompt, style: selectedStyle, includeCTA };
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
    const { prompt, style, includeCTA } = getLockAlertPrompt(lockData);
    console.log("Generating lock alert tweet with style:", style, "CTA:", includeCTA);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are a professional Twitter marketer and copywriter specializing in DeFi content. Write compelling tweets that use proven copywriting techniques: curiosity hooks, power words, emotional triggers, and professional formatting. Sound authoritative but approachable. Create tweets that professional marketers would be proud to publish. Focus on value delivery and engagement optimization."
      }, {
        role: "user",
        content: prompt
      }],
      max_tokens: 100,
      temperature: 0.8
    });
    let tweetText = completion.choices[0].message.content.trim();

    // Clean up the response
    tweetText = tweetText.replace(/^["']|["']$/g, ''); // Remove quotes
    tweetText = tweetText.replace(/\n+/g, ' '); // Replace newlines with spaces
    tweetText = tweetText.replace(/\s+/g, ' '); // Normalize whitespace

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

    console.log(`📤 Lock Alert Tweeted (style: ${style}, CTA: ${includeCTA}): ${tweetText}`);
    console.log(`🔗 Original transaction: ${lockData.explorerLink}`);

    return res.status(200).json({
      status: "tweeted",
      tweetId: data.id,
      type: "lock_alert",
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
