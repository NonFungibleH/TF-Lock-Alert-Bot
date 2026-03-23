// lib/social-scorer.js
// Queries Twitter/X API v2 for token social presence, then classifies sentiment
// via OpenAI. Always resolves (never throws) — returns { socialScore: 0 } on any failure.

const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');

const TIMEOUT_MS = 7000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    )
  ]);
}

async function classifySentiment(tweets) {
  if (!process.env.OPENAI_API_KEY || !tweets || tweets.length === 0) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const tweetText = tweets.slice(0, 10).map(t => t.text).join('\n---\n');

    const response = await withTimeout(
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `You are analyzing a DeFi token's social presence. Classify the overall sentiment of the following tweets from the token's official Twitter account as exactly one of: Positive, Neutral, or Negative. Reply with only that single word.\n\nTweets:\n${tweetText}`
          }
        ],
        max_tokens: 5
      }),
      TIMEOUT_MS
    );

    const raw = response.choices?.[0]?.message?.content?.trim() || '';
    if (['Positive', 'Neutral', 'Negative'].includes(raw)) return raw;
    return 'Neutral'; // Unexpected response → default to Neutral
  } catch {
    return null;
  }
}

async function scoreSocial(tokenSymbol, tokenName) {
  const defaultResult = {
    twitterHandle: null, twitterFollowers: null,
    twitterCreatedAt: null, twitterActiveLast7Days: false,
    twitterSentiment: null, socialScore: 0
  };

  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log('⚠️ TWITTER_BEARER_TOKEN not set — social score defaulting to 0');
    return defaultResult;
  }

  try {
    const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    const ticker = (tokenSymbol || '').replace(/^[^A-Za-z]/, ''); // strip leading $ if present
    const query = `$${ticker} OR "${tokenName || ticker}"`;

    // Search for accounts mentioning the token
    const searchResult = await withTimeout(
      client.v2.searchRecentTweets(query, {
        'tweet.fields': ['author_id', 'created_at', 'text'],
        max_results: 20
      }),
      TIMEOUT_MS
    );

    if (!searchResult?.data?.data?.length) {
      console.log(`ℹ️ No Twitter results for ${query}`);
      return defaultResult;
    }

    // Find author IDs from results, look for the most likely official account
    const authorIds = [...new Set(searchResult.data.data.map(t => t.author_id))];
    const usersResult = await withTimeout(
      client.v2.users(authorIds.slice(0, 5), {
        'user.fields': ['created_at', 'public_metrics', 'description', 'username']
      }),
      TIMEOUT_MS
    );

    const users = usersResult?.data || [];

    // Pick best match: prefer account whose username/description mentions ticker
    const tickerLower = ticker.toLowerCase();
    let matched = users.find(u =>
      u.username.toLowerCase().includes(tickerLower) ||
      (u.description || '').toLowerCase().includes(tickerLower)
    );
    if (!matched && users.length > 0) {
      // Fall back to highest follower count
      matched = users.reduce((a, b) =>
        (a.public_metrics?.followers_count || 0) > (b.public_metrics?.followers_count || 0) ? a : b
      );
    }

    if (!matched) return defaultResult;

    const handle = `@${matched.username}`;
    const followers = matched.public_metrics?.followers_count || 0;
    const createdAt = matched.created_at;
    const accountAgeDays = createdAt
      ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Check for tweets in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentTweets = searchResult.data.data.filter(t =>
      t.author_id === matched.id &&
      t.created_at &&
      new Date(t.created_at) > new Date(sevenDaysAgo)
    );
    const activeLast7Days = recentTweets.length > 0;

    // Sentiment from most recent tweets by this author
    const authorTweets = searchResult.data.data
      .filter(t => t.author_id === matched.id)
      .slice(0, 10);
    const sentiment = await classifySentiment(authorTweets);

    // Compute social score
    let score = 5; // account found
    if (accountAgeDays > 30) score += 5;
    if (followers > 2000) score += 5;
    if (activeLast7Days) score += 5;
    if (sentiment === 'Positive') score += 5;
    else if (sentiment === 'Neutral') score += 2;

    console.log(`🐦 Social score for ${tokenSymbol}: ${score}/25 (${handle}, ${followers} followers, sentiment: ${sentiment})`);

    return {
      twitterHandle: handle,
      twitterFollowers: followers,
      twitterCreatedAt: createdAt || null,
      twitterActiveLast7Days: activeLast7Days,
      twitterSentiment: sentiment,
      socialScore: score
    };
  } catch (err) {
    console.error(`❌ social-scorer failed for ${tokenSymbol}:`, err.message);
    return { ...defaultResult, socialScore: 0 };
  }
}

module.exports = { scoreSocial };
