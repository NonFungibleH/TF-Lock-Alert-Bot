const rwClient = require('./twitterClient');
const personality = require('./hunterPersonality');

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function postRandom() {
  const roll = Math.random();
  let tweet;
  if (roll < 0.4) tweet = pickRandom(personality.educational);
  else if (roll < 0.7) tweet = pickRandom(personality.marketing);
  else tweet = pickRandom(personality.fun);

  try {
    await rwClient.v2.tweet(tweet);
    console.log("📤 Scheduled tweet:", tweet);
  } catch (err) {
    console.error("❌ Failed scheduled tweet:", err.message);
  }
}

// Run every 3–5 hours
setInterval(postRandom, 1000 * 60 * 60 * (3 + Math.random() * 2));
