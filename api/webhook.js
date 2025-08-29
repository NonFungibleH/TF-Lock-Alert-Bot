const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// helper: topic → address
function topicToAddress(topic) {
  if (!topic || typeof topic !== "string" || !topic.startsWith("0x")) return null;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });

    const body = req.body || {};
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    // Moralis test ping
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });

    const chainId = body.chainId;

    // tx hash
    const txHash =
      body.logs?.[0]?.transactionHash ||
      body.txs?.[0]?.hash ||
      "N/A";

    // token address
    const firstLog = body.logs?.[0] || {};
    const decoded = firstLog.decoded || {};
    let tokenAddress = decoded.tokenAddress;
    if (!tokenAddress) tokenAddress = topicToAddress(firstLog.topic1);
    if (!tokenAddress) tokenAddress = "unknown";

    // chain info
    const CHAINS = {
      "0x1":   { name: "Ethereum", explorer: "https://etherscan.io/tx/", dex: "uniswap" },
      "1":     { name: "Ethereum", explorer: "https://etherscan.io/tx/", dex: "uniswap" },
      "0x38":  { name: "BNB Chain", explorer: "https://bscscan.com/tx/", dex: "pancake" },
      "56":    { name: "BNB Chain", explorer: "https://bscscan.com/tx/", dex: "pancake" },
      "0x89":  { name: "Polygon", explorer: "https://polygonscan.com/tx/", dex: "quickswap" },
      "137":   { name: "Polygon", explorer: "https://polygonscan.com/tx/", dex: "quickswap" },
      "0x2105":{ name: "Base", explorer: "https://basescan.org/tx/", dex: "uniswap" },
      "8453":  { name: "Base", explorer: "https://basescan.org/tx/", dex: "uniswap" },
    };
    const chainInfo = CHAINS[chainId] || { name: chainId, explorer: "", dex: "" };
    const explorerLink = chainInfo.explorer && txHash !== "N/A"
      ? `${chainInfo.explorer}${txHash}`
      : txHash;

    // team finance link
    const teamFinanceLink = tokenAddress !== "unknown"
      ? `https://www.team.finance/view-coin/${tokenAddress}?chainid=${chainId}&parentRoute=token-launches`
      : null;

    // dex trade link
    let tradeLink = null;
    if (tokenAddress !== "unknown") {
      if (chainInfo.dex === "uniswap") {
        tradeLink = `https://app.uniswap.org/#/swap?inputCurrency=${tokenAddress}`;
      } else if (chainInfo.dex === "quickswap") {
        tradeLink = `https://quickswap.exchange/#/swap?inputCurrency=${tokenAddress}`;
      } else if (chainInfo.dex === "pancake") {
        tradeLink = `https://pancakeswap.finance/swap?inputCurrency=${tokenAddress}`;
      }
    }

    // pending vs confirmed
    const statusLabel = body.confirmed ? "✅ Lock Confirmed" : "🔒 New Lock Created (pending)";

    // telegram message
    const lines = [
      `${statusLabel}`,
      `🌐 Chain: ${chainInfo.name}`,
      `🔗 [View Tx](${explorerLink})`,
    ];
    if (teamFinanceLink) lines.push(`🏷️ [Team Finance Listing](${teamFinanceLink})`);
    if (tradeLink) lines.push(`💱 [Trade on DEX](${tradeLink})`);

    const message = `\n${lines.join("\n")}\n`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    return res.status(200).json({ status: "sent", txHash, tokenAddress });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
