const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = req.body || {};
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    // Handle validation ping
    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    const chainId = body.chainId;

    const chains = {
      "0x1": "Ethereum", "1": "Ethereum",
      "0x38": "BNB Chain", "56": "BNB Chain",
      "0x89": "Polygon", "137": "Polygon",
      "0x2105": "Base", "8453": "Base",
    };
    const chain = chains[chainId] || chainId;

    // ✅ Transaction hash: prefer logs[0].transactionHash, fallback to txs[0].hash
    const txHash =
      body.logs?.[0]?.transactionHash ||
      body.txs?.[0]?.hash ||
      "N/A";

    // ✅ Only trigger if we actually have logs (means contract event fired)
    if (!body.logs || body.logs.length === 0) {
      console.log("ℹ️ No logs found, skipping");
      return res.status(200).json({ ok: true, skipped: true });
    }

    // 📩 Short Telegram message
    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chain}
🔗 Tx: ${txHash}
`;

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
