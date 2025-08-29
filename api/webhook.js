const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Utility: format seconds into months/days
function formatLockLength(unlockTime, blockTime) {
  const diff = unlockTime - blockTime;
  if (diff <= 0) return "Expired/Unlocked";

  const days = Math.floor(diff / 86400);
  const months = Math.floor(days / 30);

  if (months >= 1) return `${months} months (${days} days)`;
  return `${days} days`;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body;

    // Moralis webhook payload
    const chainId = body.chainId;
    const txHash = body.txHash;
    const blockTimestamp = Math.floor(new Date(body.block.timestamp).getTime() / 1000);

    // Map chainId → human name
    const chains = {
      "0x1": "Ethereum",
      "0x38": "BNB Chain",
      "0x89": "Polygon",
      "0x2105": "Base",
    };
    const chain = chains[chainId] || chainId;

    // Get unlockTime from logs (adjust depending on ABI)
    const unlockTime = parseInt(body.logs?.[0]?.decoded?.unlockTime || 0);

    const lockLength = formatLockLength(unlockTime, blockTimestamp);

    // Build Telegram message
    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chain}
⏳ Lock Length: ${lockLength}
🔗 [View Tx](https://${
      chain === "Ethereum"
        ? "etherscan.io"
        : chain === "Polygon"
        ? "polygonscan.com"
        : chain === "BNB Chain"
        ? "bscscan.com"
        : chain === "Base"
        ? "basescan.org"
        : ""
    }/tx/${txHash})
    `;

    // Send to Telegram
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });

    return res.status(200).json({ status: "sent", body });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
};

