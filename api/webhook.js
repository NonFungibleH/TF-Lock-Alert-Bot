const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true }); // ✅ Always return 200
    }

    const body = req.body || {};
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    // ✅ Moralis validation pings (no chainId)
    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    // --- Chain mapping ---
    const chains = {
      "0x1": "Ethereum", "1": "Ethereum",
      "0x38": "BNB Chain", "56": "BNB Chain",
      "0x89": "Polygon", "137": "Polygon",
      "0x2105": "Base", "8453": "Base",
    };
    const chain = chains[body.chainId] || body.chainId;

    // --- Transaction hash fix ---
    const txHash = body.txHash || body.txs?.[0]?.hash || "N/A";

    // --- Filter logs for Deposit / DepositNFT only ---
    const logs = body.logs || [];
    const relevantLogs = logs.filter(
      log => log.name === "Deposit" || log.name === "DepositNFT"
    );

    if (relevantLogs.length === 0) {
      console.log("ℹ️ Ignored non-lock event");
      return res.status(200).json({ ok: true, skipped: true });
    }

    // --- Send 1 alert per transaction (not per log) ---
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

    return res.status(200).json({ status: "sent", tx: txHash });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message }); // ✅ Always return 200 so Moralis is happy
  }
};
