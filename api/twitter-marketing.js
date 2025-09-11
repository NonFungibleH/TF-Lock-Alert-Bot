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
  
  return truncated;
}

// Generate varied tweet styles
function getTweetPrompt(topic) {
  const styles = [
    "casual_observation",
    "story_based", 
    "question_engagement",
    "tip_sharing",
    "warning_alert",
    "educational_thread"
  ];
  
  const selectedStyle = styles[Math.floor(Math.random() * styles.length)];
  const includeCTA = Math.random() < 0.4; // Only 40% chance of including CTA
  
  const basePrompts = {
    importance_of_locks: {
      casual_observation: "Write a casual tweet about noticing how projects with locked liquidity tend to perform better long-term. Sound like a regular crypto trader sharing an observation.",
      story_based: "Write a tweet telling a brief story about a time when checking liquidity locks saved you from a bad investment. Keep it conversational.",
      question_engagement: "Write an engaging question tweet asking followers about their DD process for liquidity locks. Make it discussion-focused.",
      tip_sharing: "Write a helpful tip tweet about what to look for in liquidity lock contracts. Sound knowledgeable but not preachy.",
      warning_alert: "Write a warning tweet about projects launching without locked liquidity. Make it urgent but not overly dramatic.",
      educational_thread: "Write an educational tweet explaining liquidity locks in simple terms. Make it accessible to newcomers."
    },
    red_flags_no_locks: {
      casual_observation: "Write a casual tweet about red flags when projects don't lock liquidity. Sound like someone who's learned from experience.",
      story_based: "Write a tweet about a project you avoided because they had no liquidity locks. Keep it brief and relatable.",
      question_engagement: "Write a tweet asking followers what their biggest red flags are when researching new projects.",
      tip_sharing: "Write a tip tweet about spotting projects that might rug pull based on their liquidity setup.",
      warning_alert: "Write an urgent but not panicked tweet about the risks of unlocked liquidity pools.",
      educational_thread: "Write an educational tweet about why unlocked liquidity is dangerous for retail investors."
    },
    how_locks_work: {
      casual_observation: "Write a casual tweet explaining liquidity locks like you're talking to a friend who's new to DeFi.",
      story_based: "Write a tweet about the first time you understood how liquidity locks work and why it was a lightbulb moment.",
      question_engagement: "Write a tweet asking followers to share their understanding of liquidity locks to help others learn.",
      tip_sharing: "Write a practical tip about how to verify liquidity locks before investing.",
      warning_alert: "Write a tweet about common misconceptions people have about liquidity locks.",
      educational_thread: "Write a simple explanation tweet about liquidity locks that a complete beginner could understand."
    },
    dd_checklist: {
      casual_observation: "Write a casual tweet about your personal DD routine, mentioning liquidity locks as one item.",
      story_based: "Write a tweet about a project that passed your DD checklist and why liquidity locks were important.",
      question_engagement: "Write a tweet asking followers what's on their DD checklist for new projects.",
      tip_sharing: "Write a tip tweet sharing 2-3 quick things to check before investing in any DeFi project.",
      warning_alert: "Write a warning tweet about skipping DD and the consequences you've seen.",
      educational_thread: "Write a tweet breaking down the most important DD steps for DeFi projects."
    },
    trust_indicators: {
      casual_observation: "Write a casual tweet about what makes you trust a DeFi project more, focusing on liquidity locks.",
      story_based: "Write a tweet about a project that built trust through their transparent liquidity practices.",
      question_engagement: "Write a tweet asking followers what trust signals they look for in DeFi projects.",
      tip_sharing: "Write a tip about recognizing trustworthy projects through their liquidity management.",
      warning_alert: "Write a warning about projects that try to appear trustworthy but have suspicious liquidity setups.",
      educational_thread: "Write an educational tweet about the relationship between locked liquidity and project credibility."
    },
    common_scams: {
      casual_observation: "Write a casual tweet about a common DeFi scam pattern you've noticed lately.",
      story_based: "Write a tweet about a scam you or someone you know avoided by checking liquidity locks.",
      question_engagement: "Write a tweet asking followers about the wildest DeFi scam they've encountered.",
      tip_sharing: "Write a tip about protecting yourself from the most common DeFi scams.",
      warning_alert: "Write an urgent warning about a specific type of liquidity-related scam.",
      educational_thread: "Write an educational tweet about how locked liquidity protects against certain scam types."
    },
    community_benefits: {
      casual_observation: "Write a casual tweet about the value of being part of a community that shares DD insights.",
      story_based: "Write a tweet about how community tips helped you make better investment decisions.",
      question_engagement: "Write a tweet asking what people value most in crypto communities.",
      tip_sharing: "Write a tip about finding and vetting good crypto communities.",
      warning_alert: "Write a warning about fake alpha groups and pump/dump communities.",
      educational_thread: "Write about the benefits of collaborative research in DeFi investing."
    }
  };

  let prompt = basePrompts[topic][selectedStyle];
  
  // Add style instructions
  prompt += " Use 1-2 relevant emojis naturally (not at the end). ";
  prompt += "Sound authentic and conversational, not like a bot or advertisement. ";
  prompt += "Vary your language - don't always say 'liquidity lock specialist' or use the same phrases. ";
  prompt += "Keep it under 240 characters to ensure it fits well with retweets. ";
  
  // Conditionally add CTA
  if (includeCTA) {
    const ctaVariations = [
      `More insights in my community: ${COMMUNITY_LINK}`,
      `Join my DD community: ${COMMUNITY_LINK}`,
      `Real-time alerts here: ${COMMUNITY_LINK}`,
      `Follow my research: ${COMMUNITY_LINK}`,
      `Community link in bio or: ${COMMUNITY_LINK}`
    ];
    const selectedCTA = ctaVariations[Math.floor(Math.random() * ctaVariations.length)];
    prompt += `Optionally end with: "${selectedCTA}"`;
  } else {
    prompt += "Do NOT include any call-to-action or community links. Just focus on the content.";
  }
  
  return { prompt, style: selectedStyle, includeCTA };
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

    // Generate marketing/educational content
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
    
    console.log("Generating tweet content for topic:", selectedTopic, "style:", style, "CTA:", includeCTA);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ 
        role: "system", 
        content: "You are a knowledgeable DeFi trader who shares insights about liquidity locks and project research. Write authentic, helpful tweets that sound human and conversational. Avoid repetitive phrases and corporate language."
      }, { 
        role: "user", 
        content: prompt 
      }],
      max_tokens: 80, // Shorter to ensure concise tweets
      temperature: 0.9 // Higher creativity for more varied content
    });

    let tweetText = completion.choices[0].message.content.trim();
    
    // Clean up the response
    tweetText = tweetText.replace(/^["']|["']$/g, ''); // Remove quotes
    tweetText = tweetText.replace(/\n+/g, ' '); // Replace newlines with spaces
    tweetText = tweetText.replace(/\s+/g, ' '); // Normalize whitespace
    
    console.log("Generated tweet text:", tweetText);
    console.log("Character length before processing:", tweetText.length);

    // Ensure tweet is under character limit
    tweetText = ensureTwitterLimit(tweetText, 275);
    
    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);

    if (tweetText.length > 280) {
      console.error("Tweet still over limit after processing:", tweetText.length);
      return res.status(400).json({ error: "Tweet exceeds character limit after processing" });
    }

    console.log("Posting to Twitter...");
    const response = await twitterClient.v2.tweet(tweetText);
    const { data } = response;

    console.log(`📤 Marketing tweet posted (topic: ${selectedTopic}, style: ${style}): ${tweetText}`);
    return res.status(200).json({ 
      status: "tweeted", 
      tweetId: data.id, 
      type: "marketing",
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
