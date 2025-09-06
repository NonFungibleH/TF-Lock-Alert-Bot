const rwClient = require('../twitterClient');
const personality = require('../hunterPersonality');

let lockCounter = 0;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });

    const body = req.body || {};
    const logs = Array.isArray(body.logs) ? body.logs : [];
    if (!logs.length) return res.status(200).json({ ok: true, note: "No logs" });

    lockCounter++;

    // Every 5th lock → tweet about it
    if (lockCounter % 5 === 0) {
      const tweet = `🔒 New liquidity lock spotted on ${body.chainId}.
Signal of trust secured. 

Join the hunt 👉 t.me/Hunt3rExe`;
      await rwClient.v2.tweet(tweet);
      console.log("📤 Lock tweet sent:", tweet);
    } else {
      // Otherwise → post personality/educational/marketing
      const roll = Math.random();
      let tweet;
      if (roll < 0.4) tweet = pickRandom(personality.educational);
      else if (roll < 0.7) tweet = pickRandom(personality.marketing);
      else tweet = pickRandom(personality.fun);

      await rwClient.v2.tweet(tweet);
      console.log("📤 Personality tweet sent:", tweet);
    }

    return res.status(200).json({ ok: true, status: "tweeted" });
  } catch (err) {
    console.error("❌ Twitter webhook error:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
};
