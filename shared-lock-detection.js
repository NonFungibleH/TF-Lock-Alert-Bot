// shared-lock-detection.js - Enhanced version with comprehensive PBTC detection
const { keccak256 } = require("js-sha3");

const sentTxs = new Set();

// Simple cleanup - just limit the set size instead of time-based tracking
function cleanupSentTxs() {
    if (sentTxs.size > 500) {
        // Convert to array, remove oldest half, convert back to set
        const txArray = Array.from(sentTxs);
        const keepTxs = txArray.slice(-250); // Keep most recent 250
        sentTxs.clear();
        keepTxs.forEach(tx => sentTxs.add(tx));
        console.log(`Cleaned sentTxs set. Size: ${sentTxs.size}`);
    }
}

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

// GoPlus specific event topics
const GOPLUS_EVENT_TOPICS = {
  "0x84b0481c1600515c2ca5bf787b1ee44cfafc7c24906e9b54bb42e7de9c6c2c17": "TokenLocked",
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
};

const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3";

// Enhanced PBTC detection constants
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();
const PBTC_DEPLOY_METHOD_ID = "0xce84399a";

// PBTC-related addresses for comprehensive detection
const PBTC_RELATED_ADDRESSES = new Set([
    "0xad7c34923db6f834ad48474acc4e0fc2476bf23f", // Original PBTC wallet
    "0xd95a366a2c887033ba71743c6342e2df470e9db9", // Proxy/deployer contract (confirmed from transactions)
]);

const PBTC_TARGET_CONTRACTS = new Set([
    "0x7feccc5e213b61a825cc5f417343e013509c8746", // Target deployment contract (confirmed from transactions)
]);

// Create GoPlus contract set for faster lookups
const GOPLUS_CONTRACT_SET = new Set(Object.keys(GOPLUS_CONTRACTS).map(s => s.toLowerCase()));

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

// Enhanced PBTC detection function
function isPbtcTransaction(body, fromAddress, chainId) {
    console.log("=== PBTC Detection Debug ===");
    console.log(`PBTC Detection - Chain ID: ${chainId}, From: ${fromAddress}`);
    
    // Only check on Base chain
    if (chainId !== "8453") {
        console.log(`✗ Not Base chain, skipping PBTC detection`);
        return false;
    }
    
    // Check 1: Known PBTC proxy address (MOST RELIABLE)
    const isKnownPbtcProxy = fromAddress === "0xd95a366a2c887033ba71743c6342e2df470e9db9";
    console.log(`PBTC proxy check: ${isKnownPbtcProxy}`);
    
    if (isKnownPbtcProxy) {
        console.log(`✓ PBTC detected via known proxy address`);
        return true;
    }
    
    // Check 2: Original PBTC wallet check
    if (fromAddress === PBTC_WALLET) {
        console.log(`✓ PBTC detected via original wallet`);
        return true;
    }
    
    // Check 3: PBTC target contract in transactions
    const txs = Array.isArray(body.txs) ? body.txs : [];
    for (const tx of txs) {
        if (tx.to && tx.to.toLowerCase() === "0x7feccc5e213b61a825cc5f417343e013509c8746") {
            console.log(`✓ PBTC detected via target contract: ${tx.to}`);
            return true;
        }
    }
    
    // Check 4: Adshares involvement in token transfers
    const logs = Array.isArray(body.logs) ? body.logs : [];
    for (const log of logs) {
        const logStr = JSON.stringify(log).toLowerCase();
        if (logStr.includes('adshares') || logStr.includes('"ads"')) {
            console.log(`✓ PBTC detected via Adshares involvement`);
            return true;
        }
    }
    
    // Check 5: PBTC deploy method
    for (const tx of txs) {
        if (tx.input && tx.input.startsWith(PBTC_DEPLOY_METHOD_ID)) {
            console.log(`✓ PBTC detected via deploy method`);
            return true;
        }
    }
    
    console.log(`✗ PBTC not detected`);
    return false;
}

function detectLock(body) {
    if (!body.chainId) return null;
    const chainId = toDecChainId(body.chainId);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
    const logs = Array.isArray(body.logs) ? body.logs : [];

    console.log(`\n=== Processing Transaction ===`);
    console.log(`Processing chain: ${chain.name} (${chainId})`);
    console.log(`Processing ${logs.length} logs`);

    // CRITICAL: PRE-CHECK FOR PBTC TRANSACTIONS BEFORE ANYTHING ELSE
    let forcePBTC = false;
    if (chainId === "8453") { // Only on Base chain
        const txs = Array.isArray(body.txs) ? body.txs : [];
        const allFromAddresses = [
            body.txs?.[0]?.from,
            body.from,
            ...txs.map(tx => tx.from),
            ...logs.map(log => log.from)
        ].filter(addr => addr).map(addr => addr.toLowerCase());

        console.log(`\n=== PBTC PRE-CHECK ===`);
        console.log(`All from addresses:`, allFromAddresses);
        console.log(`Target PBTC proxy: 0xd95a366a2c887033ba71743c6342e2df470e9db9`);

        // Check if ANY from address matches PBTC proxy
        if (allFromAddresses.includes("0xd95a366a2c887033ba71743c6342e2df470e9db9")) {
            forcePBTC = true;
            console.log(`✓✓✓ PBTC FORCE-DETECTED via from address match ✓✓✓`);
        }

        // Also check if any tx targets the PBTC contract
        const allToAddresses = txs.map(tx => tx.to).filter(addr => addr).map(addr => addr.toLowerCase());
        if (allToAddresses.includes("0x7feccc5e213b61a825cc5f417343e013509c8746")) {
            forcePBTC = true;
            console.log(`✓✓✓ PBTC FORCE-DETECTED via to address match ✓✓✓`);
        }

        // Check for Adshares involvement
        const bodyStr = JSON.stringify(body).toLowerCase();
        if (bodyStr.includes('adshares') || bodyStr.includes('"ads"')) {
            forcePBTC = true;
            console.log(`✓✓✓ PBTC FORCE-DETECTED via Adshares involvement ✓✓✓`);
        }

        console.log(`Final PBTC force decision: ${forcePBTC}\n`);
    }

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
        console.log(`Built eventMap with ${Object.keys(eventMap).length} entries`);
    }

    let lockLog = null;
    let isAdshareSource = false;
    
    // Enhanced from address extraction
    const fromAddress1 = (body.txs?.[0]?.from || "").toLowerCase();
    const fromAddress2 = (body.from || "").toLowerCase();
    const fromAddress3 = logs.length > 0 ? (logs.find(log => log.transactionHash)?.from || "").toLowerCase() : "";
    
    const fromAddress = fromAddress1 || fromAddress2 || fromAddress3;
    
    // Set isPbtcInitiated based on force decision or original detection
    let isPbtcInitiated = forcePBTC;
    if (!isPbtcInitiated) {
        isPbtcInitiated = isPbtcTransaction(body, fromAddress, chainId);
    }

    console.log(`\nFrom address: ${fromAddress}`);
    console.log(`✓✓✓ PBTC initiated: ${isPbtcInitiated} ✓✓✓\n`);

    for (let i = 0; i < logs.length; i++) {
        const l = logs[i];
        const addr = (l.address || "").toLowerCase();
        
        // Enhanced event resolution
        let ev = l.name || l.eventName || l.decoded?.name || l.decoded?.event;
        
        if (!ev && eventMap[l.topic0]) {
            ev = eventMap[l.topic0].name;
        }
        
        if (!ev && EVENT_TOPICS[l.topic0]) {
            ev = EVENT_TOPICS[l.topic0];
        }
        
        if (!ev && GOPLUS_EVENT_TOPICS[l.topic0]) {
            ev = GOPLUS_EVENT_TOPICS[l.topic0];
        }

        const isKnown = KNOWN_LOCKERS.has(addr);
        const isLockEvent = LOCK_EVENTS.has(ev);
        const isGoPlusContract = GOPLUS_CONTRACT_SET.has(addr);
        
        console.log(`Log[${i}]: addr=${addr}, event=${ev || "N/A"}, known=${isKnown}, lockEvent=${isLockEvent}`);
        
        // Priority 1: If this is a PBTC transaction, prioritize any lock event
        if (isPbtcInitiated && isKnown && isLockEvent) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`✓✓✓ PBTC priority lock detected: ${ev} from ${addr} ✓✓✓`);
            break; // Exit early for PBTC to prevent override
        }
        
        // Priority 2: Standard detection for non-PBTC transactions
        if (!isPbtcInitiated && isKnown && isLockEvent && !isGoPlusContract) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`Standard lock detected: ${ev} from ${addr}`);
        }
        
        // Priority 3: GoPlus detection (only if no other lock found)
        if (!lockLog && isGoPlusContract) {
            const goPlusLock = detectGoPlusLock(l, eventMap);
            if (goPlusLock) {
                lockLog = goPlusLock;
                console.log(`GoPlus lock detected: ${goPlusLock.resolvedEvent} from ${addr}`);
            }
        }
        
        // Adshares detection
        if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
            isAdshareSource = true;
            console.log("Detected Adshares factory source");
        }
    }

    if (!lockLog) {
        console.log("No lock event found");
        return null;
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash || body.hash;
    if (!txHash) {
        console.log(`No txHash found`);
        return null;
    }
    
    if (sentTxs.has(txHash)) {
        console.log(`Skipping duplicate txHash: ${txHash}`);
        return null;
    }
    
    // Add to set and cleanup if needed
    sentTxs.add(txHash);
    cleanupSentTxs();

    const eventName = lockLog.resolvedEvent || "Unknown";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];

    // ABSOLUTE PRIORITY: PBTC source assignment
    let source;
    console.log(`\n=== SOURCE ASSIGNMENT ===`);
    console.log(`isPbtcInitiated: ${isPbtcInitiated}`);
    
    if (isPbtcInitiated) {
        source = "PBTC";
        console.log(`✓✓✓ Source FORCED to PBTC ✓✓✓`);
    } else if (isTeamFinance) {
        source = isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance";
        console.log(`Source assigned: ${source}`);
    } else if (isGoPlus) {
        source = "GoPlus";
        console.log(`Source assigned: GoPlus`);
    } else if (uncxVersion) {
        source = "UNCX";
        console.log(`Source assigned: UNCX`);
    } else {
        source = "Unknown";
        console.log(`Source assigned: Unknown`);
    }

    // ABSOLUTE PRIORITY: PBTC type assignment - PBTC IS ALWAYS V3
    let type = "Unknown";
    console.log(`\n=== TYPE ASSIGNMENT ===`);
    console.log(`isPbtcInitiated: ${isPbtcInitiated}, eventName: ${eventName}`);
    
    if (isPbtcInitiated) {
        type = "V3 Token"; // PBTC is ALWAYS V3, NEVER V2
        console.log(`✓✓✓ Type FORCED to V3 Token (PBTC detected) ✓✓✓`);
    } else if (isTeamFinance) {
        type = eventName === "Deposit" ? "V2 Token"
            : eventName === "DepositNFT" ? "V3 Token"
            : eventName === "onLock" ? "V3 Token"
            : eventName === "LiquidityLocked" ? "V4 Token"
            : "Unknown";
        console.log(`Type assigned: ${type} (Team Finance logic)`);
    } else if (uncxVersion) {
        type = uncxVersion.includes("V2") ? uncxVersion : `${uncxVersion} Token`;
        console.log(`Type assigned: ${type} (UNCX logic)`);
    } else if (isGoPlus) {
        type = isGoPlus.includes("V2") ? isGoPlus : `${isGoPlus} Token`;
        console.log(`Type assigned: ${type} (GoPlus logic)`);
    }

    console.log(`\n=== FINAL RESULT ===`);
    console.log(`Chain: ${chain.name}`);
    console.log(`Source: ${source}`);
    console.log(`Type: ${type}`);
    console.log(`Event: ${eventName}`);
    console.log(`TxHash: ${txHash}\n`);

    return { chain, type, source, explorerLink, txHash, eventMap };
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
  detectGoPlusLock,
  isPbtcTransaction,
  cleanupSentTxs
};
