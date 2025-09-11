const axios = require("axios");
const { detectLock } = require("./shared-lock-detection"); // Import the shared detection logic

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// -----------------------------------------
// Webhook
// -----------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    
    const body = req.body || {};
    console.log("🚀 Full incoming body:", JSON.stringify(body, null, 2));
    
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });

    // Use the shared detection logic
    const lockResult = detectLock(body);
    
    if (!lockResult) {
      console.log("❌ No matching lock detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }

    const { chain, type, source, explorerLink, txHash } = lockResult;
    
    console.log(`✅ Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);

    // Check Telegram credentials
    console.log("📌 TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
    console.log("📌 TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
    
    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("❌ Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials" });
    }

    // Build and send Telegram message
    const parts = [
      "🔒 *New Lock Created*",
      `🌐 Chain: ${chain.name}`,
      `📌 Type: ${type}`,
      `🔖 Source: ${source}`,
      `🔗 [View Tx](${explorerLink})`
    ];
    const message = parts.join("\n");

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    
    console.log("📤 Telegram message sent:", message);
    return res.status(200).json({ status: "sent" });
    
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
