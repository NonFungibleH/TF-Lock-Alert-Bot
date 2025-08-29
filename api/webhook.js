const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });

    const body = req.body || {};
    const txHash = body.txs?.[0]?.hash || body.txHash || "N/A";

    const chainId = body.chainId;
    const chains = {
      "0x1": { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
      "1":   { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
      "0x38":{ name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
      "56":  { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
      "0x89":{ name: "Polygon", explorer: "https://polygonscan.com/tx/" },
      "137": { name: "Polygon", explorer: "https://polygonscan.com/tx/" },
      "0x2105": { name: "Base", explorer: "https://basescan.org/tx/" },
      "8453":   { name: "Base", explorer: "https://basescan.org/tx/" },
    };
    const chain = chains[chainId]?.name || chainId;
    const explorer = chains[chainId]?.explorer || "";

    // 🚦 Pick status label
    const statusLabel = body.confirmed ? "✅ Lock Confirmed" : "🔒 New Lock Created (pending)";

    const message = `
${statusLabel}
🌐 Chain: ${chain}
🔗 [View Tx](${explorer}${txHash})
    `;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });

    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
