import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  // ✅ Always return CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    try {
      const body = req.body;

      const message = `
🔒 *Test Lock Notification*
📦 Payload: ${JSON.stringify(body)}
      `;

      // 🚀 Send to Telegram
      const response = await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      });

      // Return both our status + Telegram’s reply
      return res.status(200).json({
        ok: true,
        telegram: response.data,
        body,
      });
    } catch (err) {
      console.error("Telegram API error:", err.response?.data || err.message);
      return res.status(500).json({
        error: "Telegram send failed",
        details: err.response?.data || err.message,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
