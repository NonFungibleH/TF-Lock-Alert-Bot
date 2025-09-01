// api/webhook.js
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// -----------------------------------------
// Helpers
// -----------------------------------------
const sentTxs = new Set();

function toDecChainId(maybeHex) {
  if (typeof maybeHex === "string" && maybeHex.startsWith("0x")) {
    return String(parseInt(maybeHex, 16));
  }
  return String(maybeHex);
}

const CHAINS = {
  "1":    { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  "56":   { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
  "137":  { name: "Polygon",  explorer: "https://polygonscan.com/tx/" },
  "8453": { name: "Base",     explorer: "https://basescan.org/tx/" },
};

// -----------------------------------------
// Known locker contracts
// -----------------------------------------
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // ETH V3
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820", // BSC V3
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a", // Base V3
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7", // Polygon V3
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = new Set([
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023", // ETH V4
  "0xfd235968e65b0990584585763f837a5b5330e6de", // ETH V3
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214", // ETH V2 Uniswap 
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab", // ETH V2 SushiSwap 
  "0xfe88dab083964c56429baa01f37ec2265abf1557", // BSC V3
  "0x7229247bd5cf29fa9b0764aa1568732be024084b", // BSC V2 Uniswap
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83", // BSC V2 PancakeSwap
  "0x610b43e981960b45f818a71cd14c91d35cda8502", // Base V4
  "0x231278edd38b00b07fbd52120cef685b9baebcc1", // Base V3
  "0xc4e637d37113192f4f1f060daebd7758de7f4131", // Base V2 UniSwap
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8", // Base V2 SushiSwap
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4", // Polygon V3
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0", // Polygon V2 QuickSwap
].map(s => s.toLowerCase()));

const KNOWN_LOCKERS = new Set([...TEAM_FINANCE_CONTRACTS, ...UNCX_CONTRACTS]);

// -----------------------------------------
// Events we care about
// -----------------------------------------
const LOCK_EVENTS = new Set([
  "onNewLock",      // TF V2
  "onDeposit",      // TF V2
  "Deposit",        // TF
  "DepositNFT",     // TF
  "onLock",         // UNCX V3
  "LiquidityLocked" // UNCX V4
]);

// Function selectors
const LOCK_FUNCTION_SELECTORS = new Set([
  // UNCX
  "0xf62f5a23", // lockNFTPosition(uint256,uint256,bool) - V4
  "0xa35a96b8", // lock(tuple params) - V3
  "0x8af416f6", // lockLPToken(address,uint256,uint256,address,bool,address) - V2 short
  "0xeb35ed62", // lockLPToken(address,uint256,uint256,address,bool,address,uint16) - V2 long
  // Team Finance
  "0x5af06fed", // lockToken(address,address,uint256,uint256,uint256,bool,address)
]);

// -----------------------------------------
// Webhook
// -----------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });

    const body = req.body || {};
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });

    const chainId = toDecChainId(body.chainId);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };

    const logs = Array.isArray(body.logs) ? body.logs : [];
    const txs = Array.isArray(body.txs) ? body.txs : [];

    let lockLog = logs.find(l => {
      const addr = (l.address || "").toLowerCase();
      const ev =
        l.name ||
        l.eventName ||
        l.decoded?.name ||
        l.decoded?.event ||
        "";
      return KNOWN_LOCKERS.has(addr) && LOCK_EVENTS.has(ev);
    });

    // Fallback: detect via tx input selectors
    if (!lockLog && txs.length) {
      const tx = txs[0];
      const toAddr = (tx.to || "").toLowerCase();
      const input = (tx.input || "").toLowerCase();
      if (KNOWN_LOCKERS.has(toAddr)) {
        for (const sel of LOCK_FUNCTION_SELECTORS) {
          if (input.startsWith(sel)) {
            lockLog = { address: toAddr, transactionHash: tx.hash, name: "functionSelector" };
          }
        }
      }
    }

    if (!lockLog) {
      return res.status(200).json({ ok: true, note: "No lock event/function detected" });
    }

    const txHash = lockLog.transactionHash || txs[0]?.hash;
    if (!txHash) return res.status(200).json({ ok: true, note: "No txHash" });

    if (sentTxs.has(txHash)) return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    sentTxs.add(txHash);

    const eventName =
      lockLog.name ||
      lockLog.eventName ||
      lockLog.decoded?.name ||
      lockLog.decoded?.event ||
      "";

    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;

    const lockerAddr = (lockLog.address || "").toLowerCase();
    const source = TEAM_FINANCE_CONTRACTS.has(lockerAddr) ? "Team Finance"
                  : UNCX_CONTRACTS.has(lockerAddr)        ? "UNCX"
                  : "Unknown";

    const type =
      eventName === "onNewLock"   ? "V2 Token" :
      eventName === "onDeposit"   ? "V2 Token" :
      eventName === "Deposit"     ? "V2 Token" :
      eventName === "DepositNFT"  ? "V3 Token" :
      eventName === "onLock"      ? "V3 Token" :
      eventName === "LiquidityLocked" ? "V4 Token" :
      lockLog.name === "functionSelector" ? "Lock Function" :
      "Unknown";

    const parts = [];
    parts.push("🔒 *New Lock Created*");
    parts.push(`🌐 Chain: ${chain.name}`);
    parts.push(`📌 Type: ${type}`);
    parts.push(`🔖 Source: ${source}`);
    parts.push(`\n🔗 [View Tx](${explorerLink})`);

    const message = parts.join("\n");

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
