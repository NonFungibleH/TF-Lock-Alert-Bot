const rwClient = require('./twitterClient');
let lockCounter = 0;

async function maybePostLock(chain, type, source) {
  lockCounter++;
  if (lockCounter % 5 !== 0) return;

  const tweet = `🔒 Lock spotted on ${chain}.
Type: ${type}, Source: ${source}.

Signal of trust locked in. 
Join the hunt 👉 t.me/Hunt3rExe`;

  try {
    await rwClient.v2.tweet(tweet);
    console.log("📤 Hunt3r tweeted:", tweet);
  } catch (err) {
    console.error("❌ Failed to tweet lock:", err.message);
  }
}

module.exports = { maybePostLock };
