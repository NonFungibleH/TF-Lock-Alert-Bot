const axios = require("axios"); 
const { keccak256 } = require("js-sha3");
const ethers = require("ethers");
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
// -----------------------------------------
// Helpers
// -----------------------------------------
const sentTxs = new Set(); // In-memory Set; consider persistent storage for production
function toDecChainId(maybeHex) {
  if (typeof maybeHex === "string" && maybeHex.startsWith("0x")) {
    return String(parseInt(maybeHex, 16));
  }
  return String(maybeHex);
}
const CHAINS = {
  "1": { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  "56": { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
  "137": { name: "Polygon", explorer: "https://polygonscan.com/tx/" },
  "8453": { name: "Base", explorer: "https://basescan.org/tx/" },
};
// -----------------------------------------
// Known locker contracts
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
const GOPLUS_CONTRACTS = {
  // Ethereum
  "0xe7873eb8dda56ed49e51c87185ebcb93958e76f2": "V4",
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  // BSC
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  // Base
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  // Polygon
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
};
const KNOWN_LOCKERS = new Set([
  ...TEAM_FINANCE_CONTRACTS,
  ...Object.keys(UNCX_CONTRACTS),
  ...Object.keys(GOPLUS_CONTRACTS),
].map(s => s.toLowerCase()));
// -----------------------------------------
// Events
// -----------------------------------------
const LOCK_EVENTS = new Set([
  "onNewLock",
  "onDeposit",
  "onLock",
  "LiquidityLocked",
  "Deposit",
  "DepositNFT"
]);

const EVENT_TOPICS = {
  "0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c": "onLock",
  "0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762": "DepositNFT",
  // Add more known topic0 to event name mappings as needed
};
// Additional known factory for unique property
const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3"; // keccak256("TokenCreated(address,string,bytes32)");
// -----------------------------------------
// Webhook
// -----------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    const body = req.body || {};
    console.log("🚀 Full incoming body:", JSON.stringify(body, null, 2));
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
    const chainId = toDecChainId(body.chainId);
    console.log(`🌐 Parsed chainId: ${chainId}`);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
    const logs = Array.isArray(body.logs) ? body.logs : [];
    console.log("🪵 Logs array length:", logs.length);
    // Build ABI event map for topic0 → {name, signature}
    const eventMap = {};
    if (Array.isArray(body.abi)) {
      body.abi.forEach(ev => {
        if (ev.type === "event") {
          const sig = `${ev.name}(${ev.inputs.map(i => i.type).join(",")})`;
          const hash = "0x" + keccak256(sig);
          eventMap[hash] = { name: ev.name, signature: sig, inputs: ev.inputs };
        }
      });
      console.log(`🗺️ Built eventMap with ${Object.keys(eventMap).length} entries`);
    }
    let lockLog = null;
    let isAdshareSource = false;
    for (let i = 0; i < logs.length; i++) {
      const l = logs[i];
      const addr = (l.address || "").toLowerCase();
      let ev =
        l.name ||
        l.eventName ||
        l.decoded?.name ||
        l.decoded?.event ||
        (eventMap[l.topic0] ? eventMap[l.topic0].name : "");
      // Resolve from known topics if not found
      if (!ev && EVENT_TOPICS[l.topic0]) {
        ev = EVENT_TOPICS[l.topic0];
        console.log(`Resolved ev from known topic0: ${ev}`);
      }
      const sig = eventMap[l.topic0]?.signature || "N/A";
      console.log(`Log[${i}]`);
      console.log(` ↳ addr=${addr}`);
      console.log(` ↳ topic0=${l.topic0}`);
      console.log(` ↳ resolvedEvent=${ev || "N/A"}`);
      console.log(` ↳ signature=${sig}`);
      const isKnown = KNOWN_LOCKERS.has(addr);
      const isLockEvent = LOCK_EVENTS.has(ev);
      console.log(`🔎 Check: known=${isKnown}, lockEvent=${isLockEvent}`);
      if (isKnown && isLockEvent) {
        lockLog = { ...l, resolvedEvent: ev };
      }
      // Check for TokenCreated event from Adshares factory
      if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
        isAdshareSource = true;
        console.log("📂 Detected Adshares factory source");
      }
    }
    if (!lockLog) {
      console.log("❌ No matching lock log found");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }
    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash) {
      console.log("⚠️ No txHash found in payload");
      return res.status(200).json({ ok: true, note: "No txHash" });
    }
    // Check for duplicate before proceeding
    if (sentTxs.has(txHash)) {
      console.log(`⏩ Duplicate txHash skipped: ${txHash}`);
      return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    }
    // Proceed only if not a duplicate
    sentTxs.add(txHash);
    const eventName = lockLog.resolvedEvent || "Unknown";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];
    console.log(`✅ Matched lockLog: addr=${lockerAddr}, event=${eventName}, source=${isTeamFinance ? "Team Finance" : isGoPlus ? "GoPlus" : uncxVersion ? "UNCX" : "Unknown"}`);
    const source = isTeamFinance ? (isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance")
                  : isGoPlus ? "GoPlus"
                  : uncxVersion ? "UNCX"
                  : "Unknown";
    let type = "Unknown";
    if (isTeamFinance) {
      type =
        eventName === "Deposit" ? "V2 Token" :
        eventName === "DepositNFT" ? "V3 Token" :
        eventName === "onLock" ? "V3 Token" :
        eventName === "LiquidityLocked" ? "V4 Token" :
        "Unknown";
    } else if (uncxVersion) {
      type = uncxVersion.includes("V2") ? uncxVersion : `${uncxVersion} Token`;
    } else if (isGoPlus) {
      type = isGoPlus.includes("V2") ? isGoPlus : `${isGoPlus} Token`;
    }
    console.log("📌 TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
    console.log("📌 TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("❌ Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials" });
    }
    const parts = [
      "🔒 *New Lock Created*",
      `🌐 Chain: ${chain.name}`,
      `📌 Type: ${type}`,
      `🔖 Source: ${source}`,
      `🔗 [View Tx](${explorerLink})`
    ];
    const message = parts.join("\n");
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    console.log("📤 Telegram message sent:", message);
    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
