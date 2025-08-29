const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Format lock length
function formatLockLength(unlockTime, blockTime) {
  const diff = unlockTime - blockTime;
  if (diff <= 0) return "Expired/Unlocked";

  const days = Math.floor(diff / 86400);
  const months = Math.floor(days / 30);
  return months >= 1 ? `${months} months (${days} days)` : `${days} days`;
}

module.exports = async (req, res) => {
  try {
    const body = req.body;

    const chainId = body.chainId;
    const txHash = body.txHash;
    const blockTimestamp = Math.floor(new Date(body.block.timestamp).getTime() / 1000);

    const chains = {
      "0x1": "Ethereum",
      "0x38": "BNB Chain",
      "0x89": "Polygon",
      "0x2105": "Base"
    };
    const chain = chains[chainId] || chainId;

    const unlockTime = parseInt(body.logs[0].decoded.unlockTime);
    const lockLength = formatLockLength(unlockTime, blockTimestamp);

    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chain}
⏳ Lock Length: ${lockLength}
🔗 Tx: https://${chain === "Ethereum" ? "etherscan.io"
               : chain === "Polygon" ? "polygonscan.com"
               : chain === "BNB Chain" ? "bscscan.com"
               : chain === "Base" ? "basescan.org"
               : ""}/tx/${txHash}
    `;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    });

    res.status(200).json({ status: "sent", body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

