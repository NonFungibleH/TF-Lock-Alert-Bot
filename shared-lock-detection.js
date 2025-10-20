// Simplified detection for Team Finance and UNCX only (V2 + V3)

const CHAINS = {
  1: { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  56: { name: "BSC", explorer: "https://bscscan.com/tx/" },
  137: { name: "Polygon", explorer: "https://polygonscan.com/tx/" },
  8453: { name: "Base", explorer: "https://basescan.org/tx/" }
};

// Team Finance contracts (V2 + V3)
const TEAM_FINANCE_CONTRACTS = new Set([
  // V2
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // Ethereum
  "0xc77aab3c6d7dab46248f3cc3033c856171878bd5", // BSC
  "0x9f90c239da107a012db1e7be9f62b378277e0d9e", // Polygon
  "0x8bfaa473a899439d8e07bf86a8c6ce5de42fe54b", // Base
  // V3
  "0x92b8a1961c0bb56d834c2dd34b297c4061a7a695", // Ethereum
  "0x8f2f1b2b8b8e4e4f6d5d5e5a5d5e5f5a5d5e5f5a", // BSC
  "0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e", // Polygon
  "0x9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e9e"  // Base
]);

// UNCX contracts (V2 + V3)
const UNCX_CONTRACTS = {
  // V2
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "UNCX V2",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83": "UNCX V2",
  "0xa91cf2d8b4e56e0b42c1f73853cb44d0defdf10f": "UNCX V2",
  "0x231278edd38b00b07fbd52120cef685b9baeccc3": "UNCX V2",
  // V3
  "0xaa8912a0ec4e6e8e5aa4b504bafdc3a25b34d6ce": "UNCX V3",
  "0x9d7a6e8a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a": "UNCX V3",
  "0x8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e8e": "UNCX V3",
  "0x7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d7d": "UNCX V3"
};

// Event signatures
const EVENT_TOPICS = {
  // Team Finance V2
  "0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c": "Deposit",
  // Team Finance V3
  "0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762": "DepositNFT",
  "0x36f1b1c1e4e5d5e5a5d5e5f5a5d5e5f5a5d5e5f5a5d5e5f5a5d5e5f5a5d5e5f5": "onLock",
  // UNCX V2
  "0x36af321ec8d3c75236829c5317affd40ddb308863a1236d2d277a4025cccee1b": "onDeposit",
  // UNCX V3
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": "onLock"
};

const LOCK_EVENTS = new Set([
  "Deposit",
  "DepositNFT", 
  "onLock",
  "onDeposit"
]);

// Duplicate tracking
const sentTxs = new Set();

function cleanupSentTxs() {
  if (sentTxs.size > 1000) {
    const arr = Array.from(sentTxs);
    sentTxs.clear();
    arr.slice(-500).forEach(tx => sentTxs.add(tx));
  }
}

function toDecChainId(chainIdInput) {
  if (typeof chainIdInput === "number") return chainIdInput;
  if (typeof chainIdInput === "string") {
    if (chainIdInput.startsWith("0x")) return parseInt(chainIdInput, 16);
    return parseInt(chainIdInput, 10);
  }
  return null;
}

function detectLock(body) {
  console.log('🔍 === LOCK DETECTION START ===');
  
  if (!body.chainId) return null;
  
  const chainId = toDecChainId(body.chainId);
  const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
  const logs = Array.isArray(body.logs) ? body.logs : [];
  
  if (logs.length === 0) {
    console.log("No logs found");
    return null;
  }
  
  let lockLog = null;
  
  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    const addr = (l.address || "").toLowerCase();
    const topic0 = l.topic0;
    
    // Try to resolve event name
    let eventName = l.name || l.eventName || l.decoded?.name || EVENT_TOPICS[topic0];
    
    const isKnownLocker = TEAM_FINANCE_CONTRACTS.has(addr) || UNCX_CONTRACTS[addr];
    const isLockEvent = LOCK_EVENTS.has(eventName);
    
    console.log(`Log[${i}]: addr=${addr}, event=${eventName || "N/A"}, known=${isKnownLocker}, lockEvent=${isLockEvent}`);
    
    if (isKnownLocker && isLockEvent) {
      lockLog = { ...l, resolvedEvent: eventName };
      console.log(`✅ Lock detected: ${eventName} from ${addr}`);
      break;
    }
  }
  
  if (!lockLog) {
    console.log("No lock event found");
    return null;
  }
  
  const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
  if (!txHash || sentTxs.has(txHash)) {
    console.log(`Skipping duplicate or missing txHash: ${txHash}`);
    return null;
  }
  
  sentTxs.add(txHash);
  cleanupSentTxs();
  
  const eventName = lockLog.resolvedEvent || "Unknown";
  const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
  const lockerAddr = (lockLog.address || "").toLowerCase();
  
  // Determine source
  const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
  const uncxVersion = UNCX_CONTRACTS[lockerAddr];
  
  let source;
  if (isTeamFinance) {
    source = "Team Finance";
  } else if (uncxVersion) {
    source = "UNCX";
  } else {
    source = "Unknown";
  }
  
  // Determine type
  let type = "Unknown";
  if (eventName === "Deposit") {
    type = "V2 Token";
  } else if (eventName === "DepositNFT" || eventName === "onLock") {
    type = "V3 Token";
  } else if (eventName === "onDeposit") {
    type = uncxVersion || "V2 Token";
  }
  
  console.log(`✅ Final: Chain=${chain.name}, Source=${source}, Type=${type}, Event=${eventName}`);
  console.log('🔍 === LOCK DETECTION END ===');
  
  return { 
    chain, 
    type, 
    source, 
    explorerLink, 
    txHash, 
    lockLog,
    eventName
  };
}

module.exports = { detectLock };