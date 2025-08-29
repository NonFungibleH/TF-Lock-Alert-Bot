import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  // --- CORS fix ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // 👈 handle preflight
  }
  // -----------------

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    if (!body.chainId || !body.txHash) {
      return res.status(200).json({ status: "webhook verified" });
    }

    const chainId = body.chainId;
    const txHash = body.txHash;

    const blockTimestamp = body.block?.timestamp
      ? Math.floor(new Date(body.block.timestamp).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    let unlockTime = null;
    let amount = null;

    if (body.logs?.[0]?.decoded) {
      unlockTime = parseInt(body.logs[0].decoded.unlockTime || 0);
      amount = body.logs[0].decoded.amount || null;
    }

    const diff = unlockTime ? unlockTime - blockTimestamp : 0;
    let lockLength = "Unknown";
    if (diff > 0) {
      const days = Math.floor(diff / 86400);
      const months = Math.floor(days / 30);
      lockLength = months >= 1 ? `${months} months (${days} days)` : `${days} days`;
    }

    const chains = {
      "0x1": "Ethereum",
      "0x38": "BNB Chain",
      "0x89": "Polygon",
      "0x2105": "Base"
    };
    const chain = chains[chainId] || chainId;

    const message = `
🔒 *New Lock Created*
🌐 Chain: ${chain}
💰 Amount: ${amount || "Unknown"}
⏳ Lock Length: ${lockLength}
🔗 Tx: https://${
      chain === "Ethereum" ? "etherscan.io" :
      chain === "Polygon" ? "polygonscan.com" :
      chain === "BNB Chain" ? "bscscan.com" :
      chain === "Base" ? "basescan.org" : ""
    }/tx/${txHash}
    `;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown"
    });

    return res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(200).json({ status: "error", message: err.message });
  }
}
