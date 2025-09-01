// api/webhook.js
const axios = require("axios");
const { ethers } = require("ethers");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// -----------------------------------------
// Helpers
// -----------------------------------------
const sentTxs = new Set();

function formatUSD(num) {
  return `$${Number(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toDecChainId(maybeHex) {
  if (typeof maybeHex === "string" && maybeHex.startsWith("0x")) {
    return String(parseInt(maybeHex, 16));
  }
  return String(maybeHex);
}

// Per-chain settings
const CHAINS = {
  "1":    { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  "56":   { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
  "137":  { name: "Polygon",  explorer: "https://polygonscan.com/tx/" },
  "8453": { name: "Base",     explorer: "https://basescan.org/tx/" },
};

// -----------------------------------------
// Known locker contracts (lowercased)
// -----------------------------------------
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xdbf72370021babafbceb05ab10f99ad275c6220a",
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb",
  "0x7536592bb74b5d62eb82e8b93b17eed4eed9a85c",
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820",
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a",
  "0x586c21a779c24efd2a8af33c9f7df2a2ea9af55c",
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7",
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = new Set([
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023",
  "0xfd235968e65b0990584585763f837a5b5330e6de",
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab",
  "0xfe88dab083964c56429baa01f37ec2265abf1557",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83",
  "0x610b43e981960b45f818a71cd14c91d35cda8502",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131",
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8",
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0",
].map(s => s.toLowerCase()));

const KNOWN_LOCKERS = new Set([...TEAM_FINANCE_CONTRACTS, ...UNCX_CONTRACTS]);

// -----------------------------------------
// ABIs & constants
// -----------------------------------------
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const LP_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)"
];

// Events we consider a **new lock**
const LOCK_EVENTS = new Set(["onNewLock", "onDeposit", "onLock", "LiquidityLocked"]);

// Function selectors (first 4 bytes of input) for Team Finance
const LOCK_FUNCTION_SELECTORS = new Set([
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
    let lockLog = logs.find(l => {
      const addr = (l.address || "").toLowerCase();
      const ev = l.name || l.decoded?.name || "";
      return KNOWN_LOCKERS.has(addr) && LOCK_EVENTS.has(ev);
    });

    // Fallback: check tx input for lockToken
    let isFuncLock = false;
    if (!lockLog && body.txs?.length) {
      const tx = body.txs[0];
      const toAddr = (tx.to || "").toLowerCase();
      const input = (tx.input || "").toLowerCase();
      if (TEAM_FINANCE_CONTRACTS.has(toAddr)) {
        for (const sel of LOCK_FUNCTION_SELECTORS) {
          if (input.startsWith(sel)) {
            isFuncLock = true;
            lockLog = { address: toAddr, transactionHash: tx.hash, name: "lockToken" };
          }
        }
      }
    }

    if (!lockLog) {
      return res.status(200).json({ ok: true, note: "No lock event/function detected" });
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash) return res.status(200).json({ ok: true, note: "No txHash" });

    if (sentTxs.has(txHash)) return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    sentTxs.add(txHash);

    const eventName = lockLog.name || lockLog.decoded?.name || "";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;

    const type =
      eventName === "onNewLock"       ? "V2 Token" :
      eventName === "onDeposit"       ? "V2 Token" :
      eventName === "onLock"          ? "V3 Token" :
      eventName === "LiquidityLocked" ? "V4 Token" :
      isFuncLock                      ? "V2 Token" : "Unknown";

    const lockerAddr = (lockLog.address || "").toLowerCase();
    const source = TEAM_FINANCE_CONTRACTS.has(lockerAddr) ? "Team Finance"
                  : UNCX_CONTRACTS.has(lockerAddr)        ? "UNCX"
                  : "Unknown";

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
