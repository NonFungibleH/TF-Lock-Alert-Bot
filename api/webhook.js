export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "POST") {
    try {
      console.log("ENV TELEGRAM_TOKEN:", process.env.TELEGRAM_TOKEN);
      console.log("ENV TELEGRAM_CHAT_ID:", process.env.TELEGRAM_CHAT_ID);
      console.log("BODY:", req.body);

      return res.status(200).json({
        ok: true,
        token: process.env.TELEGRAM_TOKEN ? "set" : "missing",
        chat: process.env.TELEGRAM_CHAT_ID ? "set" : "missing",
        body: req.body
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
