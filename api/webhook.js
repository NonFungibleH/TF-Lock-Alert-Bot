const axios = require("axios");
const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    
    const body = req.body || {};
    console.log("Full incoming body:", JSON.stringify(body, null, 2));
    
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
    
    // Use shared detection logic
    const lockResult = detectLock(body);
    
    if (!lockResult) {
      console.log("No matching lock detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }
    
    const { chain, type, source, explorerLink, txHash } = lockResult;
    
    console.log(`Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
    
    // PART 1: Save to Database (new functionality)
    let dbSaved = false;
    try {
      const db = new LockAlertDatabase();
      const logs = Array.isArray(body.logs) ? body.logs : [];
      const lockLog = logs.find(l => l.transactionHash === txHash);
      
      await db.addLockAlert({
        chain,
        type,
        source,
        explorerLink,
        txHash,
        contractAddress: lockLog?.address || null,
        eventName: lockResult.eventMap ? Object.values(lockResult.eventMap)[0]?.name : null,
        tokenAddress: null,
        tokenSymbol: null,
        tokenAmount: null,
        tokenPriceAtLock: null,
        usdValueAtLock: null
      });
      
      console.log(`✅ Saved to database: ${txHash}`);
      dbSaved = true;
    } catch (dbError) {
      // Don't fail the whole webhook if database fails
      console.error("⚠️ Database save failed (continuing to Telegram):", dbError.message);
    }
    
    // PART 2: Send to Telegram (existing functionality)
    console.log("TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
    console.log("TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
    
    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials", dbSaved });
    }
    
    // Build and send Telegram message
    const parts = [
      "🔒 **New Lock Created**",
      `🌐 Chain: ${chain.name}`,
      `📌 Type: ${type}`,
      `🔖 Source: ${source}`,
      `🔗 [View Transaction](${explorerLink})`
    ];
    const message = parts.join("\n");
    
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    
    console.log("✅ Telegram message sent:", message);
    
    return res.status(200).json({ 
      status: "sent",
      dbSaved,
      txHash
    });
    
  } catch (err) {
    console.error("❌ Webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
