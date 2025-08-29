import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  // ✅ Always add CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    try {
      // Ensure body is parsed
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const message = `
🔒 *Lock Notification*
📦 Payload: ${JSON.stringify(body, null, 2)}
      `;

      // Send message to Telegram
      const tgResponse = await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown"
        }
      );

      // Return both body + Telegram response
      return res.status(200).json({
        ok: true,
        body,
        telegram_response: tgResponse.data
      });
    } catch (err) {
      console.error("Webhook error:", err.response?.data || err.message);

      return res.status(500).json({
        ok: false,
        error: err.message,
        details: err.response?.data || "No details"
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
