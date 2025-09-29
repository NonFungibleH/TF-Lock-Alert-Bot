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

function ensureTwitterLimit(text, maxLength = 275) {
  if (text.length <= maxLength) return text;
  let truncated = text.substring(0, maxLength);
  const lastBreak = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
  if (lastBreak > maxLength * 0.75) truncated = truncated.substring(0, lastBreak + 1);
  truncated = truncated.trim().split('. ').slice(0, -1).join('.\n') + (truncated.includes('.') ? '' : '...');
  if (includeCTA && !truncated.endsWith(COMMUNITY_LINK.replace('https://t.co/', ''))) truncated += ` 🔍 More tips: ${COMMUNITY_LINK}`;
  return truncated.replace(/amazing|incredible|exclusive|proven|VIP/gi, '').replace(/!{2,}/g, '!');
}

function getTweetPrompt(topic) {
  const TONE_TEMPLATE = `
  Write a single tweet under 240 characters.
  - Voice of @Hunt3r.exe, a sharp-eyed DeFi tracker sharing practical tips.
  - ${["casual", "warning", "insightful"][Math.floor(Math.random() * 3)]} tone—like chatting with peers over coffee.
  - Use 0–1 emojis if natural (e.g., 🔍 for hunting) after a line break.
  - Limit to 2–3 key points max, use line breaks for readability.
  - No hype words like 'secret', 'amazing', 'proven', 'VIP'.
  - If including a CTA, end naturally with: "${selectedCTA}" as an invite to discuss.
  `;
  const TOPIC_GUIDANCE = {
    importance_of_locks: "Highlight why liquidity locks matter for trust. e.g., Locks signal commitment.",
    red_flags_no_locks: "Point out a key red flag with unlocked liquidity. e.g., Unlocked = exit risk.",
    how_locks_work: "Explain liquidity locks in a simple, quick way. e.g., Tokens held to prevent dumps.",
    dd_checklist: "Share 2–3 must-check items before investing. e.g., Audits, team transparency.",
    trust_indicators: "Mention 1–2 trust signals to look for. e.g., Audited by CertiK, active AMAs.",
    common_scams: "Warn about one common DeFi scam to avoid. e.g., Rug pulls via fake locks.",
    community_benefits: "Note a key perk of joining a DeFi community. e.g., Real-time scam alerts."
  };
  if (!TOPIC_GUIDANCE[topic]) throw new Error(`Topic '${topic}' not found`);
  const includeCTA = Math.random() < 0.4;
  const selectedCTA = includeCTA ? PROFESSIONAL_CTAS[Math.floor(Math.random() * PROFESSIONAL_CTAS.length)] : '';
  let fullPrompt = `${TONE_TEMPLATE}\nTopic: ${topic}.\n${TOPIC_GUIDANCE[topic]}`;
  fullPrompt += includeCTA ? `\nInclude the CTA to drive to Telegram for more insights.` : `\nNo CTA – focus solely on delivering direct tips.`;
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
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const expectedAuth = "Bearer " + process.env.TWITTER_BEARER_TOKEN;
    if (!authHeader || authHeader !== expectedAuth) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const topics = ["importance_of_locks", "red_flags_no_locks", "how_locks_work", "dd_checklist", "trust_indicators", "common_scams", "community_benefits"];
    const selectedTopic = topics[Math.floor(Math.random() * topics.length)];
   
    let tweetPromptResult;
    try {
      tweetPromptResult = getTweetPrompt(selectedTopic);
    } catch (error) {
      return res.status(400).json({
        error: "Topic validation failed",
        details: error.message
      });
    }
    const { prompt, style, includeCTA } = tweetPromptResult;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: "You are @Hunt3r.exe, a sharp-eyed DeFi tracker. Write clear, concise tweets with a casual, expert tone—like sharing tips with peers. Avoid hype. Examples: 'Liquidity locks? They're trust in action. No lock, no deal.' or 'Red flag alert: unlocked liquidity. Join @Hunt3r.exe on Telegram to dig deeper: https://t.co/iEAhyR2PgC' or 'Trust indicators matter in DeFi. 🔍 Look for: Audited contracts. Active community. Stay sharp.'"
      }, {
        role: "user",
        content: prompt
      }],
      max_tokens: 100,
      temperature: 0.7
    });
    let tweetText = completion.choices[0].message.content.trim().replace(/^["']|["']$/g, '').replace(/\n+/g, ' ').replace(/\s+/g, ' ');
    tweetText = ensureTwitterLimit(tweetText, 275);
    if (tweetText.length > 280) {
      return res.status(400).json({ error: "Tweet exceeds character limit" });
    }
    const response = await twitterClient.v2.tweet(tweetText);
    const { data } = response;
    return res.status(200).json({
      status: "tweeted",
      tweetId: data.id,
      type: "professional_marketing",
      topic: selectedTopic,
      style: style,
      includedCTA: includeCTA,
      content: tweetText,
      length: tweetText.length,
      complianceChecks: {
        characterLimit: tweetText.length <= 240,
        emojiCount: (tweetText.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length,
        noHypeWords: !/amazing|incredible|exclusive|proven|VIP|secret/i.test(tweetText),
        ctaAsPlanned: includeCTA
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: "Twitter API request failed",
      code: err.code,
      details: err.data
    });
  }
};
