import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // ✅ Handle Moralis verification ping
    if (!body.chainId || !body.txHash) {
      return res.status(200).json({ status: "webhook verified" });
    }

    // --- Extract info (like lock length etc.) ---
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

    const message = `
    🔒 *New Lock Created*
    🌐 Chain: ${chainId}
    💰 Amount: ${amount || "Unknown"}
    ⏳ UnlockTime: ${unlockTime || "Unknown"}
    🔗 Tx: ${txHash}
    `;

    // Send to Telegram
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
