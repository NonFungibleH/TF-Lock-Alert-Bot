const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = req.body || {};

    // 🔍 Log full payload so you can check what Moralis sends
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    // Handle validation ping from Moralis
    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    // Extract basics
    const chainId = body.chainId;
    const txHash = body.txHash || "N/A";

    const chains = {
      "0x1": "Ethereum", "1": "Ethereum",
      "0x38": "BNB Chain", "56": "BNB Chain",
      "0x89": "Polygon", "137": "Polygon",
      "0x2105": "Base", "8453": "Base",
    };
    const chain = chains[chainId] || chainId;

    // 📩 Short Telegram message
    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chain}
🔗 Tx: ${txHash}
`;

    // Send Telegram alert
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });

    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};

