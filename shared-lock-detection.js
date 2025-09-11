// shared-lock-detection.js - Updated with GoPlus support
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

// Enhanced lock events including GoPlus events
const LOCK_EVENTS = new Set([
  "onNewLock", "onDeposit", "onLock", "LiquidityLocked", "Deposit", "DepositNFT",
  // GoPlus specific events  
  "TokenLocked", "LockCreated", "NewLock", "CreateLock", "Lock", "LockToken",
  // NFT events for GoPlus V3/V4
  "Transfer", "Mint"
]);

const EVENT_TOPICS = {
  "0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c": "onLock",
  "0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762": "DepositNFT",
  // ERC721 Transfer for NFT-based locks
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
};

// GoPlus specific event topics (update these as you discover more)
const GOPLUS_EVENT_TOPICS = {
  "0x84b0481c1600515c2ca5bf787b1ee44cfafc7c24906e9b54bb42e7de9c6c2c17": "TokenLocked",
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
};

const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3";
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();
const PBTC_DEPLOY_METHOD_ID = "0xce84399a";

// GoPlus detection functions
function detectGoPlusLock(log, eventMap) {
  const addr = (log.address || "").toLowerCase();
  const goPlusVersion = GOPLUS_CONTRACTS[addr];
  
  if (!goPlusVersion) return null;
  
  // Try to get event name from multiple sources
  const eventName = log.name || log.eventName || log.decoded?.name || log.decoded?.event || 
                   (eventMap[log.topic0] ? eventMap[log.topic0].name : "") ||
                   GOPLUS_EVENT_TOPICS[log.topic0];
  
  // Check for standard lock events
  if (LOCK_EVENTS.has(eventName)) {
    return { ...log, resolvedEvent: eventName };
  }
  
  // Special handling for NFT-based locks (V3/V4)
  if (goPlusVersion.includes("V3") || goPlusVersion.includes("V4")) {
    // Check for ERC721 Transfer events (minting new lock NFTs)
    if (log.topic0 === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
      const topics = log.topics || [];
      // Check if it's minting (from address 0x0)
      if (topics.length >= 3 && topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return { ...log, resolvedEvent: "Transfer" };
      }
    }
  }
  
  return null;
}

function isPbtcTransaction(body, fromAddress, chainId) {
  // Check 1: Transaction initiated by PBTC wallet on Base chain
  if (fromAddress === PBTC_WALLET && chainId === "8453") {
    return true;
  }
  
  // Check 2: Look for deployTokenAndCreatePoolProxy method call
  const txs = Array.isArray(body.txs) ? body.txs : [];
  for (const tx of txs) {
    if (tx.input && tx.input.startsWith(PBTC_DEPLOY_METHOD_ID)) {
      return true;
    }
  }
  
  return false;
}

function detectLock(body) {
  if (!body.chainId) return null;
  const chainId = toDecChainId(body.chainId);
  const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
  const logs = Array.isArray(body.logs) ? body.logs : [];

  // Build ABI event map
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
  const fromAddress = (body.txs?.[0]?.from || "").toLowerCase();
  const isPbtcInitiated = isPbtcTransaction(body, fromAddress, chainId);

  for (const l of logs) {
    const addr = (l.address || "").toLowerCase();
    
    // Enhanced event resolution
    let ev = l.name || l.eventName || l.decoded?.name || l.decoded?.event || 
             (eventMap[l.topic0] ? eventMap[l.topic0].name : "") ||
             GOPLUS_EVENT_TOPICS[l.topic0];
             
    if (!ev && EVENT_TOPICS[l.topic0]) {
      ev = EVENT_TOPICS[l.topic0];
    }

    const isKnown = KNOWN_LOCKERS.has(addr);
    const isLockEvent = LOCK_EVENTS.has(ev);
    
    // Standard detection for non-GoPlus contracts
    if (isKnown && isLockEvent && !Object.keys(GOPLUS_CONTRACTS).map(s => s.toLowerCase()).includes(addr)) {
      lockLog = { ...l, resolvedEvent: ev };
    }
    
    // Special GoPlus detection
    if (!lockLog) {
      const goPlusLock = detectGoPlusLock(l, eventMap);
      if (goPlusLock) {
        lockLog = goPlusLock;
      }
    }
    
    // Adshares detection
    if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
      isAdshareSource = true;
    }
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

  // Updated source logic - PBTC takes priority
  let source;
  if (isPbtcInitiated) {
    source = "PBTC";
  } else if (isTeamFinance) {
    source = isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance";
  } else if (isGoPlus) {
    source = "GoPlus";
  } else if (uncxVersion) {
    source = "UNCX";
  } else {
    source = "Unknown";
  }

  // Updated type logic
  let type = "Unknown";
  if (isPbtcInitiated) {
    type = "V3 Token";
  } else if (isTeamFinance) {
    type = eventName === "Deposit" ? "V2 Token"
      : eventName === "DepositNFT" ? "V3 Token"
      : eventName === "onLock" ? "V3 Token"
      : eventName === "LiquidityLocked" ? "V4 Token"
      : "Unknown";
  } else if (uncxVersion) {
    type = uncxVersion.includes("V2") ? uncxVersion : `${uncxVersion} Token`;
  } else if (isGoPlus) {
    type = isGoPlus.includes("V2") ? isGoPlus : `${isGoPlus} Token`;
  }

  return { chain, type, source, explorerLink, txHash };
}

module.exports = { 
  detectLock, 
  CHAINS, 
  toDecChainId, 
  GOPLUS_CONTRACTS, 
  TEAM_FINANCE_CONTRACTS,
  UNCX_CONTRACTS,
  KNOWN_LOCKERS,
  LOCK_EVENTS,
  detectGoPlusLock
};
