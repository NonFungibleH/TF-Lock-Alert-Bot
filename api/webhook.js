const axios = require("axios");
const { ethers } = require("ethers");
const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// RPC endpoints - Use env vars first, then fallback to premium public RPCs
const RPC_URLS = {
  1: [
    process.env.ETHEREUM_RPC,
    "https://eth.llamarpc.com",
    "https://ethereum-rpc.publicnode.com",
    "https://eth.meowrpc.com",
    "https://eth.drpc.org"
  ].filter(Boolean),
  
  56: [
    process.env.BSC_RPC,
    "https://bsc.drpc.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc.meowrpc.com",
    "https://bsc-dataseed.bnbchain.org"
  ].filter(Boolean),
  
  137: [
    process.env.POLYGON_RPC,
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com",
    "https://1rpc.io/matic",
    "https://endpoints.omniatech.io/v1/matic/mainnet/public"
  ].filter(Boolean),
  
  8453: [
    process.env.BASE_RPC,
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://base.meowrpc.com",
    "https://endpoints.omniatech.io/v1/base/mainnet/public"
  ].filter(Boolean)
};

// ERC20 ABI for token info
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

// Send initial Telegram message
async function sendTelegramMessage(text) {
  const response = await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }
  );
  return response.data.result.message_id;
}

// Convert chainId to decimal
function toDecChainId(chainIdInput) {
  if (typeof chainIdInput === "number") return chainIdInput;
  if (typeof chainIdInput === "string") {
    if (chainIdInput.startsWith("0x")) return parseInt(chainIdInput, 16);
    return parseInt(chainIdInput, 10);
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    // Health check endpoint
    if (req.method === "GET") {
      return res.status(200).json({ 
        status: "healthy",
        timestamp: new Date().toISOString(),
        telegram: !!(TELEGRAM_TOKEN && TELEGRAM_GROUP_CHAT_ID)
      });
    }
    
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    
    const body = req.body || {};
    console.log("Full incoming body:", JSON.stringify(body, null, 2));
    
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
    
    // Use shared detection logic (Team Finance + UNCX only)
    const lockResult = detectLock(body);
    
    if (!lockResult) {
      console.log("No matching lock detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }
    
    const { chain, type, source, explorerLink, txHash, lockLog, eventName } = lockResult;
    const chainId = toDecChainId(body.chainId);
    
    console.log(`Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
    
    // PART 1: Save to Database (best effort - don't fail if this breaks)
    let dbSaved = false;
    try {
      const db = new LockAlertDatabase();
      
      await db.addLockAlert({
        chain,
        type,
        source,
        explorerLink,
        txHash,
        contractAddress: lockLog?.address || null,
        eventName: eventName,
        tokenAddress: null,
        tokenSymbol: null,
        tokenAmount: null,
        tokenPriceAtLock: null,
        usdValueAtLock: null
      });
      
      console.log(`✅ Saved to database: ${txHash}`);
      dbSaved = true;
    } catch (dbError) {
      console.error("⚠️ Database save failed (continuing to Telegram):", dbError.message);
    }
    
    // PART 2: Send to Telegram
    console.log("TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
    console.log("TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
    
    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials", dbSaved });
    }
    
    // Send basic notification immediately
    const basicMessage = [
      "🔒 **NEW LOCK DETECTED**",
      "",
      `🌐 Chain: ${chain.name}`,
      `🔖 Source: ${source}`,
      `📌 Type: ${type}`,
      "",
      "⏳ _Fetching token details..._",
      "",
      `[View Transaction](${explorerLink})`
    ].join("\n");
    
    const messageId = await sendTelegramMessage(basicMessage);
    console.log(`✅ Basic Telegram message sent (ID: ${messageId})`);
    
    // PART 3: Trigger enrichment via separate endpoint
// Build enrichment URL - use production domain
const enrichmentPayload = {
  messageId,
  txHash,
  chainId,
  lockLog,
  eventName,
  source,
  explorerLink,
  chain: chain.name,
  txData: body.txData || null,  // ADD THIS - pass through if available
  blockNumber: body.confirmed?.[0]?.blockNumber || null  // ADD THIS - for LP mint lookup
};
    
    try {
      const baseUrl = process.env.BASE_URL || 'https://tf-lock-alert-bot.vercel.app';
      const enrichmentUrl = `${baseUrl}/api/enrich-lock`;
      
      console.log(`🔗 Enrichment URL: ${enrichmentUrl}`);
      
      // FIXED: Start the enrichment request WITHOUT waiting for completion
      // Use a promise but DON'T await it - this ensures the request is sent
      // before the function terminates, but we don't wait for the response
      const enrichmentPromise = axios.post(enrichmentUrl, enrichmentPayload, {
        timeout: 45000, // 45 seconds for enrichment to complete
        headers: {
          'Content-Type': 'application/json'
        }
      }).then(response => {
        console.log(`✅ Enrichment completed:`, response.status);
      }).catch(enrichErr => {
        console.error(`❌ Enrichment failed:`, enrichErr.message);
        if (enrichErr.response) {
          console.error(`Status: ${enrichErr.response.status}`);
        }
      });
      
      // Don't await, but ensure the request has been initiated
      // Small delay to ensure HTTP connection is established
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (urlErr) {
      console.error("⚠️ Failed to trigger enrichment:", urlErr.message);
      // Continue anyway, webhook already responded
    }
    
    // Respond to webhook after enrichment has been triggered
    return res.status(200).json({ 
      status: "sent",
      dbSaved,
      txHash,
      messageId
    });
    
  } catch (err) {
    console.error("❌ Webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
