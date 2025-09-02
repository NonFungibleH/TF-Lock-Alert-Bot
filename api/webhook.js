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
// Known locker contracts (Team Finance + UNCX)
// -----------------------------------------
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // ETH V3
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820", // BSC V3
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a", // BASE V3
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7", // Polygon V3
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = {
  // Ethereum
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023": "V4",
  "0xfd235968e65b0990584585763f837a5b5330e6de": "V3",
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "Uniswap V2",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab": "SushiSwap V2",

  // BSC
  "0xfe88dab083964c56429baa01f37ec2265abf1557": "V3",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b": "Uniswap V2",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83": "PancakeSwap V2",

  // Base
  "0x610b43e981960b45f818a71cd14c91d35cda8502": "V4",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1": "V3",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131": "Uniswap V2",
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8": "SushiSwap V2",

  // Polygon
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4": "V3",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0": "QuickSwap V2",
};

const KNOWN_LOCKERS = new Set([
  ...TEAM_FINANCE_CONTRACTS,
  ...Object.keys(UNCX_CONTRACTS),
]);

// -----------------------------------------
// Events
// -----------------------------------------
const LOCK_EVENTS = new Set([
  "onNewLock",
  "onDeposit",
  "onLock",
  "LiquidityLocked",
  "Deposit",      // Team Finance
  "DepositNFT"    // Team Finance
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

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
  chat_id: TELEGRAM_GROUP_CHAT_ID,
  text: `🪵 Incoming logs:\n${logs.map(l => l.name || l.decoded?.name || l.eventName || "unknown").join(", ")}`,
});

    if (!lockLog) {
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
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

    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];

    const source = isTeamFinance ? "Team Finance"
                  : uncxVersion   ? "UNCX"
                  : "Unknown";

    // Type mapping
    let type = "Unknown";
    if (isTeamFinance) {
      type =
        eventName === "onNewLock"   ? "V2 Token" :
        eventName === "onDeposit"   ? "V2 Token" :
        eventName === "Deposit"     ? "V2 Token" :
        eventName === "DepositNFT"  ? "V3 Token" :
        eventName === "onLock"      ? "V3 Token" :
        eventName === "LiquidityLocked" ? "V4 Token" :
        "Unknown";
    } else if (uncxVersion) {
      // For UNCX we want to be more descriptive if it's a V2 DEX
      if (uncxVersion.includes("V2")) {
        type = uncxVersion; // e.g. "Uniswap V2" or "SushiSwap V2"
      } else {
        type = `${uncxVersion} Token`; // e.g. "V3 Token", "V4 Token"
      }
    }

    const parts = [];
    parts.push("🔒 *New Lock Created*");
    parts.push(`🌐 Chain: ${chain.name}`);
    parts.push(`📌 Type: ${type}`);
    parts.push(`🔖 Source: ${source}`);
    parts.push(`🔗 [View Tx](${explorerLink})`);

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

