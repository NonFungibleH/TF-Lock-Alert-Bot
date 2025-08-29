import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ✅ Vercel config to ensure body parsing + avoid warnings
export const config = {
  api: {
    bodyParser: true,
    externalResolver: true,
  },
};

export default async function handler(req, res) {
  // ✅ Always set CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization"
  );

  // ✅ Handle browser/Moralis preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ✅ Handle POST requests
  if (req.method === "POST") {
    try {
      const body = req.body || {};

      // Build Telegram message
      const message = `
🔒 *Test Lock Notification*
📦 Payload: ${JSON.stringify(body, null, 2)}
      `;

      // Send to Telegram
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "Markdown",
        }
      );

      return res.status(200).json({ status: "sent", body });
    } catch (err) {
      console.error("❌ Telegram send failed:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Anything else = not allowed
  return res.status(405).json({ error: "Method not allowed" });
}
