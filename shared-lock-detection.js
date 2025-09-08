// shared-lock-detection.js
const { keccak256 } = require("js-sha3");

const sentTxs = new Set(); // Shared in-memory; for prod, use Redis or similar if needed

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

const TEAM_FINANCE_CONTRACTS = new Set([
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // ETH V3
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820", // BSC V3
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a", // BASE V3
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7", // Polygon V3
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = {
  // ... (copy from your original code)
};

const GOPLUS_CONTRACTS = {
  // ... (copy from your original code)
};

const KNOWN_LOCKERS = new Set([
  ...TEAM_FINANCE_CONTRACTS,
  ...Object.keys(UNCX_CONTRACTS),
  ...Object.keys(GOPLUS_CONTRACTS),
].map(s => s.toLowerCase()));

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
};

const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3";
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();

function detectLock(body) {
  if (!body.chainId) return null;
  const chainId = toDecChainId(body.chainId);
  const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
  const logs = Array.isArray(body.logs) ? body.logs : [];

  // Build ABI event map (copy from original)
  const eventMap = {};
  if (Array.isArray(body.abi)) {
    body.abi.forEach(ev => {
      if (ev.type === "event") {
        const sig = `${ev.name}(${ev.inputs.map(i => i.type).join(",")})`;
        const hash = "0x" + keccak256(sig);
        eventMap[hash] = { name: ev.name, signature: sig, inputs: ev.inputs };
      }
    });
  }

  let lockLog = null;
  let isAdshareSource = false;
  let isPbtcInitiated = false;
  const fromAddress = (body.txs?.[0]?.from || "").toLowerCase();

  for (const l of logs) {
    const addr = (l.address || "").toLowerCase();
    let ev = l.name || l.eventName || l.decoded?.name || l.decoded?.event || (eventMap[l.topic0] ? eventMap[l.topic0].name : "");
    if (!ev && EVENT_TOPICS[l.topic0]) ev = EVENT_TOPICS[l.topic0];

    const isKnown = KNOWN_LOCKERS.has(addr);
    const isLockEvent = LOCK_EVENTS.has(ev);
    if (isKnown && isLockEvent) {
      lockLog = { ...l, resolvedEvent: ev };
    }
    if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
      isAdshareSource = true;
    }
  }

  if (fromAddress === PBTC_WALLET && chainId === "8453") {
    isPbtcInitiated = true;
  }

  if (!lockLog) return null;

  const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
  if (!txHash || sentTxs.has(txHash)) return null;
  sentTxs.add(txHash);

  const eventName = lockLog.resolvedEvent || "Unknown";
  const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
  const lockerAddr = (lockLog.address || "").toLowerCase();
  const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
  const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
  const uncxVersion = UNCX_CONTRACTS[lockerAddr];

  const source = isTeamFinance
    ? isPbtcInitiated ? "Team Finance (via PBTC)" : isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance"
    : isGoPlus ? "GoPlus" : uncxVersion ? "UNCX" : "Unknown";

  let type = "Unknown";
  if (isTeamFinance) {
    type = isPbtcInitiated ? "V3 Token" : eventName === "Deposit" ? "V2 Token" : eventName === "DepositNFT" ? "V3 Token" : eventName === "onLock" ? "V3 Token" : eventName === "LiquidityLocked" ? "V4 Token" : "Unknown";
  } else if (uncxVersion) {
    type = uncxVersion.includes("V2") ? uncxVersion : `${uncxVersion} Token`;
  } else if (isGoPlus) {
    type = isGoPlus.includes("V2") ? isGoPlus : `${isGoPlus} Token`;
  }

  return { chain, type, source, explorerLink, txHash };
}

module.exports = { detectLock, CHAINS, toDecChainId /* add others if needed */ };
