const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TOKENGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function formatDate(unixTime) {
  if (!unixTime) return "N/A";
  const date = new Date(unixTime * 1000);
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = req.body || {};
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    const chainId = body.chainId;
    const txHash =
      body.logs?.[0]?.transactionHash ||
      body.txs?.[0]?.hash ||
      "N/A";

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

    const chainInfo = chains[chainId] || { name: chainId, explorer: "" };
    const explorerLink = chainInfo.explorer ? `${chainInfo.explorer}${txHash}` : txHash;

    // detect type from logs
    const logs = body.logs || [];
    const log = logs[0] || {};
    const eventName = log.name || log.decoded?.name || "";
    const type = eventName === "DepositNFT" ? "V3 Token" : "V2 Token";

    // expiry from decoded event
    const unlockTime = parseInt(log.decoded?.unlockTime || 0);
    const expiry = unlockTime ? formatDate(unlockTime) : "N/A";

    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chainInfo.name}
📌 Type: ${type}
⏳ Unlocks: ${expiry}
🔗 [View Tx](${explorerLink})
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
