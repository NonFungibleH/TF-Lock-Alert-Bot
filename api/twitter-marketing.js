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

// Generate professional tweet prompts with copywriting techniques
function getTweetPrompt(topic) {
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
  const includeCTA = Math.random() < 0.3; // Reduced to 30% for less promotional feel
  
  const professionalPrompts = {
    importance_of_locks: {
      curiosity_hook: "Write a curiosity-driven tweet starting with 'Why' or 'What' about liquidity locks. Use power words like 'secret', 'hidden', or 'truth'. Make readers want to click to learn more.",
      urgency_driven: "Write an urgent tweet about liquidity locks using phrases like 'Don't miss this' or 'Time-sensitive'. Create FOMO without being overly dramatic.",
      authority_based: "Write an authoritative tweet about liquidity locks starting with 'Research shows' or 'Data confirms'. Sound like an expert sharing insider knowledge.",
      warning_alert: "Write a warning tweet about projects without locked liquidity. Use 'Warning:', 'Alert:', or 'Avoid this mistake:' as the hook.",
      social_proof: "Write a tweet using social proof about liquidity locks. Reference community size, number of successful trades, or widespread adoption.",
      news_format: "Write a news-style tweet about liquidity locks using 'Breaking:', 'Update:', or 'Industry news:' as the opener.",
      question_engagement: "Write an engaging question about liquidity locks that can't be answered with yes/no. Make readers want to share their experience.",
      benefit_focused: "Write a benefit-driven tweet about liquidity locks using words like 'simple', 'easy', 'proven' method to identify good projects."
    },
    red_flags_no_locks: {
      curiosity_hook: "Write a curiosity tweet starting with 'What' or 'The truth about' regarding red flags in DeFi projects without liquidity locks.",
      urgency_driven: "Write an urgent tweet about red flags, using 'Act now' or 'Don't wait' to encourage immediate action on due diligence.",
      authority_based: "Write an expert-level tweet about red flags starting with 'Industry veterans know' or 'Professionals look for'.",
      warning_alert: "Write a strong warning tweet about specific red flags using 'Critical error:' or 'Danger:' as the hook.",
      social_proof: "Write a social proof tweet about red flags that mentions community consensus or widespread recognition of these warning signs.",
      news_format: "Write a news-style tweet about recent red flag patterns using 'Alert:' or 'Market update:' as the opener.",
      question_engagement: "Write a thought-provoking question about the biggest red flags followers have encountered in DeFi.",
      benefit_focused: "Write a benefit-focused tweet about the 'simple' or 'proven' way to spot red flags before they cost you money."
    },
    how_locks_work: {
      curiosity_hook: "Write a curiosity-driven educational tweet starting with 'How' or 'The secret behind' liquidity locks.",
      urgency_driven: "Write an urgent educational tweet using 'Learn this now' or 'Don't invest until you know' about liquidity locks.",
      authority_based: "Write an authoritative educational tweet starting with 'Smart investors understand' about how liquidity locks work.",
      warning_alert: "Write a warning-style educational tweet about the consequences of not understanding liquidity locks.",
      social_proof: "Write an educational tweet using social proof about how successful traders use knowledge of liquidity locks.",
      news_format: "Write a news-style educational tweet announcing 'New guide:' or 'Breaking down:' liquidity locks.",
      question_engagement: "Write an educational question that tests readers' understanding of liquidity locks.",
      benefit_focused: "Write a benefit-focused educational tweet about the 'simple' way to understand and verify liquidity locks."
    },
    dd_checklist: {
      curiosity_hook: "Write a curiosity tweet starting with 'What' or 'The checklist' about due diligence items most people miss.",
      urgency_driven: "Write an urgent tweet about DD checklists using 'Before you invest' or 'Critical steps' as the hook.",
      authority_based: "Write an authoritative tweet about DD starting with 'Professional traders always' or 'Experts recommend'.",
      warning_alert: "Write a warning tweet about skipping DD steps using 'Don't make this mistake:' or 'Fatal error:' as the hook.",
      social_proof: "Write a social proof tweet about DD practices that mentions successful community members or widespread adoption.",
      news_format: "Write a news-style tweet about DD using 'New methodology:' or 'Updated checklist:' as the opener.",
      question_engagement: "Write an engaging question about which DD steps followers consider most important.",
      benefit_focused: "Write a benefit-focused tweet about the 'simple' or 'proven' DD process that saves money."
    },
    trust_indicators: {
      curiosity_hook: "Write a curiosity tweet starting with 'What' or 'The secret signs' about trust indicators in DeFi projects.",
      urgency_driven: "Write an urgent tweet about trust indicators using 'Spot this immediately' or 'Look for this first'.",
      authority_based: "Write an authoritative tweet about trust signals starting with 'Experienced traders know' or 'Data shows'.",
      warning_alert: "Write a warning tweet about fake trust indicators using 'Beware:' or 'Red flag:' as the hook.",
      social_proof: "Write a social proof tweet about trust indicators that references community consensus.",
      news_format: "Write a news-style tweet about trust indicators using 'Market insight:' or 'Analysis reveals:' as the opener.",
      question_engagement: "Write a question about which trust indicators followers find most reliable.",
      benefit_focused: "Write a benefit-focused tweet about the 'fastest' or 'most reliable' way to assess project trustworthiness."
    },
    common_scams: {
      curiosity_hook: "Write a curiosity tweet starting with 'Why' or 'The scam' about common DeFi fraud patterns.",
      urgency_driven: "Write an urgent tweet about scams using 'Protect yourself now' or 'Don't be the next victim'.",
      authority_based: "Write an authoritative tweet about scams starting with 'Security experts warn' or 'Analysis confirms'.",
      warning_alert: "Write a strong warning tweet about specific scam types using 'Alert:' or 'Scam warning:' as the hook.",
      social_proof: "Write a social proof tweet about scam protection that references community awareness.",
      news_format: "Write a news-style tweet about scams using 'Breaking:' or 'Scam alert:' as the opener.",
      question_engagement: "Write a question about the most sophisticated scams followers have encountered.",
      benefit_focused: "Write a benefit-focused tweet about the 'simple' way to avoid common DeFi scams."
    },
    community_benefits: {
      curiosity_hook: "Write a curiosity tweet starting with 'What' or 'The power of' about community collaboration in DeFi research.",
      urgency_driven: "Write an urgent tweet about community benefits using 'Join now' or 'Don't research alone'.",
      authority_based: "Write an authoritative tweet about communities starting with 'Successful traders know' or 'Studies prove'.",
      warning_alert: "Write a warning tweet about isolation in DeFi research using 'Don't go alone:' as the hook.",
      social_proof: "Write a social proof tweet about community benefits referencing member success stories.",
      news_format: "Write a news-style tweet about communities using 'Community update:' or 'Growth milestone:' as the opener.",
      question_engagement: "Write a question about what followers value most in DeFi research communities.",
      benefit_focused: "Write a benefit-focused tweet about the 'proven' advantages of community-based research."
    }
  };

  const basePrompt = professionalPrompts[topic][selectedStyle];
  
  // Enhanced style instructions with professional copywriting techniques
  let fullPrompt = basePrompt + " ";
  fullPrompt += "Apply these professional Twitter tactics: ";
  fullPrompt += "1) Keep it concise but impactful - aim for 200-240 characters ";
  fullPrompt += "2) Use power words naturally (amazing, proven, secret, exclusive, critical) ";
  fullPrompt += "3) Create curiosity gaps that make people want to learn more ";
  fullPrompt += "4) Write in active voice with confident, authoritative tone ";
  fullPrompt += "5) Use 1-2 relevant emojis strategically (not at the end) ";
  fullPrompt += "6) Appeal to emotions - make it feel urgent, exclusive, or valuable ";
  fullPrompt += "7) Sound like a professional marketer who knows copywriting ";
  fullPrompt += "8) Avoid repetitive phrases and corporate jargon ";
  fullPrompt += "9) Make every word count - no filler or fluff ";
  
  // Conditionally add CTA with professional phrasing
  if (includeCTA) {
    const professionalCTAs = [
      `📚 Deep dive: ${COMMUNITY_LINK}`,
      `🔍 Full analysis: ${COMMUNITY_LINK}`,
      `💎 VIP insights: ${COMMUNITY_LINK}`,
      `⚡ Real-time alerts: ${COMMUNITY_LINK}`,
      `🎯 Join 5,000+ smart traders: ${COMMUNITY_LINK}`
    ];
    const selectedCTA = professionalCTAs[Math.floor(Math.random() * professionalCTAs.length)];
    fullPrompt += `10) Optionally end with this professional CTA: "${selectedCTA}" `;
  } else {
    fullPrompt += "10) NO call-to-action or links - focus purely on delivering value ";
  }
  
  return { prompt: fullPrompt, style: selectedStyle, includeCTA };
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
        content: "You are a professional Twitter marketer and copywriter specializing in DeFi content. Write compelling tweets that use proven copywriting techniques: curiosity hooks, power words, emotional triggers, and professional formatting. Sound authoritative but approachable. Create tweets that professional marketers would be proud to publish. Focus on value delivery and engagement optimization."
      }, { 
        role: "user", 
        content: prompt 
      }],
      max_tokens: 100, // Increased for more sophisticated content
      temperature: 0.8 // Balanced creativity with consistency
    });

    let tweetText = completion.choices[0].message.content.trim();
    
    // Clean up the response
    tweetText = tweetText.replace(/^["']|["']$/g, ''); // Remove quotes
    tweetText = tweetText.replace(/\n+/g, ' '); // Replace newlines with spaces
    tweetText = tweetText.replace(/\s+/g, ' '); // Normalize whitespace
    
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
