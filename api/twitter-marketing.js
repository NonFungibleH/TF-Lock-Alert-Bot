const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});
const COMMUNITY_LINK = "https://t.co/iEAhyR2PgC"; // Replace with your Telegram link

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

function getTweetPrompt(topic) {
  const includeCTA = Math.random() < 0.4;
  const selectedCTA = includeCTA ? PROFESSIONAL_CTAS[Math.floor(Math.random() * PROFESSIONAL_CTAS.length)] : '';

  const TONE_TEMPLATE = `
  Write a single tweet under 240 characters.
  - Voice of @Hunt3r.exe, a sharp-eyed DeFi tracker sharing practical tips.
  - Plain, confident tone—like chatting with peers over coffee.
  - Use 0–1 emojis if natural (e.g., 🔍 for hunting).
  - Limit to 2–3 key points max, use line breaks for readability.
  - No hype words like 'secret', 'amazing', 'proven', 'VIP'.
  - If including a CTA, end naturally with: "${selectedCTA}" as an invite to discuss.
  `;

  const TOPIC_GUIDANCE = {
    importance_of_locks: "Highlight why liquidity locks matter for trust.",
    red_flags_no_locks: "Point out a key red flag with unlocked liquidity.",
    how_locks_work: "Explain liquidity locks in a simple, quick way.",
    dd_checklist: "Share 2–3 must-check items before investing.",
    trust_indicators: "Mention 1–2 trust signals to look for.",
    common_scams: "Warn about one common DeFi scam to avoid.",
    community_benefits: "Note a key perk of joining a DeFi community."
  };

  let fullPrompt = `${TONE_TEMPLATE}\nTopic: ${topic}.\n${TOPIC_GUIDANCE[topic]}`;
  if (includeCTA) {
    fullPrompt += `\nInclude the CTA to drive to Telegram for more insights.`;
  } else {
    fullPrompt += `\nNo CTA – focus on delivering a quick tip.`;
  }

  return { prompt: fullPrompt, style: "plain", includeCTA };
}

const PROFESSIONAL_CTAS = [
  `Join @Hunt3r.exe on Telegram for more: ${COMMUNITY_LINK}`,
  `Chat DeFi tips in our Telegram: ${COMMUNITY_LINK}`,
  `Track scams with us on Telegram: ${COMMUNITY_LINK}`,
  `Get live insights in Telegram: ${COMMUNITY_LINK}`,
  `Join 5k+ hunters on Telegram: ${COMMUNITY_LINK}`
];

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

    const topics = ["importance_of_locks", "red_flags_no_locks", "how_locks_work", "dd_checklist", "trust_indicators", "common_scams", "community_benefits"];
    const selectedTopic = topics[Math.floor(Math.random() * topics.length)];
    const { prompt, style, includeCTA } = getTweetPrompt(selectedTopic);

    console.log("Generating tweet for topic:", selectedTopic, "CTA:", includeCTA);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are @Hunt3r.exe, a sharp-eyed DeFi tracker. Write clear, concise tweets with a casual, expert tone—like sharing tips with peers. Avoid hype. Examples: 'Liquidity locks? They’re trust in action. No lock, no deal.' or 'Red flag alert: unlocked liquidity. Join @Hunt3r.exe on Telegram to dig deeper: https://t.co/iEAhyR2PgC'"
      }, {
        role: "user",
        content: prompt
      }],
      max_tokens: 50, // Reduced to enforce brevity
      temperature: 0.6
    });

    let tweetText = completion.choices[0].message.content.trim();
    tweetText = tweetText.replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');

    console.log("Generated tweet text:", tweetText);
    console.log("Character length before processing:", tweetText.length);

    tweetText = ensureTwitterLimit(tweetText, 275);

    console.log("Final tweet text:", tweetText);
    console.log("Final character length:", tweetText.length);
    if (tweetText.length > 280) {
      console.error("Tweet still over limit:", tweetText.length);
      return res.status(400).json({ error: "Tweet exceeds character limit" });
    }

    console.log("Posting tweet to Twitter...");
    const response = await twitterClient.v2.tweet(tweetText);
    const { data } = response;
    console.log(`📤 Tweet posted (topic: ${selectedTopic}): ${tweetText}`);
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
