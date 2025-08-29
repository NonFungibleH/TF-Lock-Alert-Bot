import axios from "axios";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Ensure body is JSON
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 🔍 Debug log — will show up in Vercel logs
    console.log("Incoming body:", body);
    console.log("TELEGRAM_CHAT_ID:", TELEGRAM_CHAT_ID ? "set" : "MISSING");
    console.log("TELEGRAM_TOKEN:", TELEGRAM_TOKEN ? "set" : "MISSING");

    // Build Telegram message
    const message = `🔒 Test Lock\n\n${JSON.stringify(body, null, 2)}`;

    // Send to Telegram
    const tgResponse = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
      }
    );

    return res.status(200).json({
      ok: true,
      sent_to: TELEGRAM_CHAT_ID,
      telegram: tgResponse.data,
    });
  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message || err);

    return res.status(500).json({
      ok: false,
      error: err.message ||
