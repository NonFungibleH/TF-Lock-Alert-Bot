// Simplified detection for Team Finance and UNCX only (V2 + V3)

const CHAINS = {
  1: { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
  56: { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
  137: { name: "Polygon", explorer: "https://polygonscan.com/tx/" },
  8453: { name: "Base", explorer: "https://basescan.org/tx/" }
};

// Team Finance contracts (V3 only - from your working backup)
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // ETH V3
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820", // BSC V3
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a", // BASE V3
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7"  // Polygon V3
]);

// UNCX contracts (ALL versions - from your working backup)
const UNCX_CONTRACTS = {
  // Ethereum
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023": "UNCX V4",
  "0xfd235968e65b0990584585763f837a5b5330e6de": "UNCX V3", 
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "UNCX Uniswap V2",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab": "UNCX SushiSwap V2",
  // BSC
  "0xfe88dab083964c56429baa01f37ec2265abf1557": "UNCX V3",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b": "UNCX Uniswap V2", 
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83": "UNCX PancakeSwap V2",
  // Base
  "0x610b43e981960b45f818a71cd14c91d35cda8502": "UNCX V4",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1": "UNCX V3",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131": "UNCX Uniswap V2",
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8": "UNCX SushiSwap V2",
  // Polygon
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4": "UNCX V3",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0": "UNCX QuickSwap V2"
};

// Event signatures
const EVENT_TOPICS = {
  // Team Finance V3
  "0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c": "onLock",
  "0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762": "DepositNFT",
  // UNCX V2/V3/V4
  "0x36af321ec8d3c75236829c5317affd40ddb308863a1236d2d277a4025cccee1b": "onDeposit",
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer"
};

const LOCK_EVENTS = new Set([
  "onNewLock",
  "onDeposit",
  "onLock", 
  "DepositNFT",
  "Deposit",
  "LiquidityLocked",
  "Transfer"
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
    
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(addr);
    const uncxVersion = UNCX_CONTRACTS[addr];
    const isKnownLocker = isTeamFinance || uncxVersion;
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
  if (isTeamFinance) {
    type = eventName === "onLock" ? "V3 Token"
        : eventName === "DepositNFT" ? "V3 Token"
        : eventName === "LiquidityLocked" ? "V4 Token"
        : "V3 Token";
  } else if (uncxVersion) {
    type = uncxVersion;
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