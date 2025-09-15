const axios = require("axios");
const { keccak256 } = require("js-sha3");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// -----------------------------------------
// Enhanced Token Data Extraction Functions
// -----------------------------------------

// Get token symbol from contract (simplified version)
async function getTokenSymbol(tokenAddress, chainName) {
    try {
        console.log(`🏷️ Getting symbol for token ${tokenAddress} on ${chainName}`);
        
        // For now, returning a generic symbol
        // TODO: Integrate with Moralis, Alchemy, or direct contract calls
        return 'TOKEN';
        
    } catch (error) {
        console.error('❌ Error getting token symbol:', error);
        return 'UNKNOWN';
    }
}

// Get token price from CoinGecko
async function getTokenPrice(tokenAddress, chainId) {
    try {
        const platformMap = {
            '1': 'ethereum',
            '56': 'binance-smart-chain',
            '137': 'polygon-pos',
            '8453': 'base'
        };

        const platform = platformMap[chainId];
        if (!platform) {
            console.log(`❌ Unsupported chain ID for pricing: ${chainId}`);
            return null;
        }

        console.log(`💰 Fetching price for ${tokenAddress} on ${platform}`);

        const response = await axios.get(
            `https://api.coingecko.com/api/v3/simple/token_price/${platform}`,
            {
                params: {
                    contract_addresses: tokenAddress,
                    vs_currencies: 'usd'
                },
                timeout: 5000
            }
        );

        const price = response.data[tokenAddress.toLowerCase()]?.usd;
        
        if (price) {
            console.log(`✅ Price found: $${price}`);
            return price;
        } else {
            console.log(`❌ No price data for token ${tokenAddress}`);
            return null;
        }
        
    } catch (error) {
        console.error(`❌ Error fetching price for ${tokenAddress}:`, error.message);
        return null;
    }
}

function getChainIdFromName(chainName) {
    const chainMap = {
        'Ethereum': '1',
        'BNB Chain': '56',
        'Polygon': '137',
        'Base': '8453'
    };
    return chainMap[chainName] || '1';
}

// Team Finance token extraction
async function extractTeamFinanceData(lockLog, lockResult) {
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🏢 Extracting Team Finance data');
        
        if (lockLog.decoded && lockLog.decoded.inputs) {
            const inputs = lockLog.decoded.inputs;
            console.log('📋 Team Finance decoded inputs:', inputs);

            for (const input of inputs) {
                if (input.name === 'token' && input.value) {
                    tokenData.address = input.value.toLowerCase();
                    console.log('🎯 Found token address:', tokenData.address);
                }
                if ((input.name === 'amount' || input.name === 'value') && input.value) {
                    tokenData.amount = parseFloat(input.value) / Math.pow(10, 18);
                    console.log('📊 Found token amount:', tokenData.amount);
                }
            }
        }

        // Fallback to topics parsing
        if (!tokenData.address && lockLog.topics && lockLog.topics.length > 1) {
            const tokenAddressTopic = lockLog.topics[1];
            if (tokenAddressTopic && tokenAddressTopic.startsWith('0x')) {
                tokenData.address = '0x' + tokenAddressTopic.slice(-40);
                console.log('🎯 Extracted token from topics:', tokenData.address);
            }
        }

        if (tokenData.address) {
            tokenData.symbol = await getTokenSymbol(tokenData.address, lockResult.chain.name);
        }

    } catch (error) {
        console.error('❌ Error extracting Team Finance data:', error);
    }

    return tokenData;
}

// UNCX token extraction
async function extractUNCXData(lockLog, lockResult) {
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🔒 Extracting UNCX data');
        
        if (lockLog.decoded && lockLog.decoded.inputs) {
            const inputs = lockLog.decoded.inputs;
            console.log('📋 UNCX decoded inputs:', inputs);

            for (const input of inputs) {
                if ((input.name === 'lpToken' || input.name === 'token') && input.value) {
                    tokenData.address = input.value.toLowerCase();
                    console.log('🎯 Found LP token address:', tokenData.address);
                }
                if (input.name === 'amount' && input.value) {
                    tokenData.amount = parseFloat(input.value) / Math.pow(10, 18);
                    console.log('📊 Found LP amount:', tokenData.amount);
                }
            }
        }

        // Fallback to topics parsing
        if (!tokenData.address && lockLog.topics && lockLog.topics.length > 1) {
            const tokenAddressTopic = lockLog.topics[1];
            if (tokenAddressTopic && tokenAddressTopic.startsWith('0x')) {
                tokenData.address = '0x' + tokenAddressTopic.slice(-40);
                console.log('🎯 Extracted LP token from topics:', tokenData.address);
            }
        }

        if (tokenData.address) {
            tokenData.symbol = await getTokenSymbol(tokenData.address, lockResult.chain.name) || 'LP-TOKEN';
        }

    } catch (error) {
        console.error('❌ Error extracting UNCX data:', error);
    }

    return tokenData;
}

// GoPlus token extraction
async function extractGoPlusData(lockLog, lockResult) {
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🛡️ Extracting GoPlus data');
        
        if (lockLog.decoded && lockLog.decoded.inputs) {
            const inputs = lockLog.decoded.inputs;
            console.log('📋 GoPlus decoded inputs:', inputs);

            for (const input of inputs) {
                if (input.name === 'token' && input.value) {
                    tokenData.address = input.value.toLowerCase();
                    console.log('🎯 Found token address:', tokenData.address);
                }
                if (input.name === 'amount' && input.value) {
                    tokenData.amount = parseFloat(input.value) / Math.pow(10, 18);
                    console.log('📊 Found token amount:', tokenData.amount);
                }
            }
        }

        if (tokenData.address) {
            tokenData.symbol = await getTokenSymbol(tokenData.address, lockResult.chain.name);
        }

    } catch (error) {
        console.error('❌ Error extracting GoPlus data:', error);
    }

    return tokenData;
}

// Enhanced token data extraction main function
async function extractTokenDataFromLogs(body, lockResult) {
    const logs = Array.isArray(body.logs) ? body.logs : [];
    
    let tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🔍 Extracting token data from', logs.length, 'logs');

        // Find the specific lock log that triggered the alert
        const lockLog = logs.find(log => {
            const addr = (log.address || "").toLowerCase();
            const eventName = log.name || log.eventName || log.decoded?.name || log.decoded?.event;
            
            const isKnownLocker = KNOWN_LOCKERS.has(addr);
            const isLockEvent = LOCK_EVENTS.has(eventName);
            
            console.log(`🔍 Checking log: addr=${addr}, event=${eventName}, known=${isKnownLocker}, lockEvent=${isLockEvent}`);
            
            return isKnownLocker && isLockEvent;
        });

        if (!lockLog) {
            console.log('❌ No lock log found for token extraction');
            return tokenData;
        }

        console.log('✅ Found lock log:', JSON.stringify(lockLog, null, 2));

        // Extract token data based on platform
        const contractAddr = (lockLog.address || "").toLowerCase();
        
        if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) {
            tokenData = await extractTeamFinanceData(lockLog, lockResult);
        } else if (UNCX_CONTRACTS[contractAddr]) {
            tokenData = await extractUNCXData(lockLog, lockResult);
        } else if (GOPLUS_CONTRACTS[contractAddr]) {
            tokenData = await extractGoPlusData(lockLog, lockResult);
        }

        // If we have a token address, get current price
        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            const currentPrice = await getTokenPrice(tokenData.address, chainId);
            
            if (currentPrice) {
                tokenData.priceAtLock = currentPrice;
                if (tokenData.amount > 0) {
                    tokenData.usdValue = tokenData.amount * currentPrice;
                }
                console.log(`💰 Token price fetched: $${currentPrice} for ${tokenData.symbol}`);
            }
        }

        console.log('🎯 Final token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('❌ Error extracting token data:', error);
        return tokenData;
    }
}

// -----------------------------------------
// Enhanced Dashboard Integration Function
// -----------------------------------------
async function sendToDashboard(lockResult, body, tokenData) {
    try {
        const dashboardData = {
            ...lockResult,
            // Extract additional data from the webhook body if available
            contractAddress: body.logs?.find(log => log.resolvedEvent)?.address,
            eventName: body.logs?.find(log => log.resolvedEvent)?.resolvedEvent,
            blockNumber: body.txs?.[0]?.blockNumber,
            gasUsed: body.txs?.[0]?.gasUsed,
            timestamp: new Date().toISOString(),
            
            // Enhanced token data
            tokenAddress: tokenData.address,
            tokenSymbol: tokenData.symbol,
            tokenAmount: tokenData.amount,
            tokenPriceAtLock: tokenData.priceAtLock,
            usdValueAtLock: tokenData.usdValue
        };
        
        // Use relative URL to avoid authentication issues
const dashboardUrl = '/api/locks';
console.log('📊 Dashboard URL:', dashboardUrl);
console.log('📊 Sending to dashboard:', JSON.stringify(dashboardData, null, 2));
const response = await axios.post(dashboardUrl, dashboardData, {
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    }
});
        
        console.log('✅ Lock sent to dashboard:', lockResult.txHash);
        return response.data;
        
    } catch (error) {
        console.error('❌ Failed to send to dashboard:', error.message);
        if (error.response) {
            console.error('Dashboard response status:', error.response.status);
            console.error('Dashboard response data:', error.response.data);
        }
        return null;
    }
}

// -----------------------------------------
// Shared Detection Logic (Inline)
// -----------------------------------------
const sentTxs = new Set();

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
    "0xe2fe530c047f2d85298b07d9333c05737f1435fb",
    "0x0c89c0407775dd89b12918b9c0aa42bf96518820",
    "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a",
    "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7",
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = {
    "0x30529ac67d5ac5f33a4e7fe533149a567451f023": "V4",
    "0xfd235968e65b0990584585763f837a5b5330e6de": "V3", 
    "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "Uniswap V2",
    "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab": "SushiSwap V2",
    "0xfe88dab083964c56429baa01f37ec2265abf1557": "V3",
    "0x7229247bd5cf29fa9b0764aa1568732be024084b": "Uniswap V2", 
    "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83": "PancakeSwap V2",
    "0x610b43e981960b45f818a71cd14c91d35cda8502": "V4",
    "0x231278edd38b00b07fbd52120cef685b9baebcc1": "V3",
    "0xc4e637d37113192f4f1f060daebd7758de7f4131": "Uniswap V2",
    "0xbeddF48499788607B4c2e704e9099561ab38Aae8": "SushiSwap V2",
    "0x40f6301edb774e8b22adc874f6cb17242baeb8c4": "V3",
    "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0": "QuickSwap V2",
};

const GOPLUS_CONTRACTS = {
    "0xe7873eb8dda56ed49e51c87185ebcb93958e76f2": "V4",
    "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
    "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
};

const KNOWN_LOCKERS = new Set([
    ...TEAM_FINANCE_CONTRACTS,
    ...Object.keys(UNCX_CONTRACTS),
    ...Object.keys(GOPLUS_CONTRACTS),
].map(s => s.toLowerCase()));

const LOCK_EVENTS = new Set([
    "onNewLock", "onDeposit", "onLock", "LiquidityLocked", "Deposit", "DepositNFT",
    "TokenLocked", "LockCreated", "NewLock", "CreateLock", "Lock", "LockToken",
    "Transfer", "Mint"
]);

const EVENT_TOPICS = {
    "0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c": "onLock",
    "0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762": "DepositNFT",
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
};

const GOPLUS_EVENT_TOPICS = {
    "0x84b0481c1600515c2ca5bf787b1ee44cfafc7c24906e9b54bb42e7de9c6c2c17": "TokenLocked",
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer",
};

const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3";
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();
const PBTC_DEPLOY_METHOD_ID = "0xce84399a";

const GOPLUS_CONTRACT_SET = new Set(Object.keys(GOPLUS_CONTRACTS).map(s => s.toLowerCase()));

function detectGoPlusLock(log, eventMap) {
    const addr = (log.address || "").toLowerCase();
    const goPlusVersion = GOPLUS_CONTRACTS[addr];
    
    if (!goPlusVersion) return null;
    
    const eventName = log.name || log.eventName || log.decoded?.name || log.decoded?.event || 
                     (eventMap[log.topic0] ? eventMap[log.topic0].name : "") ||
                     GOPLUS_EVENT_TOPICS[log.topic0];
    
    if (LOCK_EVENTS.has(eventName)) {
        return { ...log, resolvedEvent: eventName };
    }
    
    if (goPlusVersion.includes("V3") || goPlusVersion.includes("V4")) {
        if (log.topic0 === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") {
            const topics = log.topics || [];
            if (topics.length >= 3 && topics[1] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                return { ...log, resolvedEvent: "Transfer" };
            }
        }
    }
    
    return null;
}

function isPbtcTransaction(body, fromAddress, chainId) {
    if (fromAddress === PBTC_WALLET && chainId === "8453") {
        return true;
    }
    
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

    console.log(`🌐 Processing chain: ${chain.name} (${chainId})`);
    console.log(`🪵 Processing ${logs.length} logs`);

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
    const fromAddress = (body.txs?.[0]?.from || "").toLowerCase();
    const isPbtcInitiated = isPbtcTransaction(body, fromAddress, chainId);

    console.log(`👤 From address: ${fromAddress}`);
    console.log(`🅿️ PBTC initiated: ${isPbtcInitiated}`);

    for (let i = 0; i < logs.length; i++) {
        const l = logs[i];
        const addr = (l.address || "").toLowerCase();
        
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
        
        console.log(`Log[${i}]: addr=${addr}`);
        console.log(`  ↳ topic0=${l.topic0}`);
        console.log(`  ↳ event=${ev || "N/A"}`);
        console.log(`  ↳ known=${isKnown}, lockEvent=${isLockEvent}, goplus=${isGoPlusContract}`);
        
        if (isKnown && isLockEvent && !isGoPlusContract) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`✅ Standard lock detected: ${ev} from ${addr}`);
        }
        
        if (!lockLog && isGoPlusContract) {
            const goPlusLock = detectGoPlusLock(l, eventMap);
            if (goPlusLock) {
                lockLog = goPlusLock;
                console.log(`✅ GoPlus lock detected: ${goPlusLock.resolvedEvent} from ${addr}`);
            }
        }
        
        if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
            isAdshareSource = true;
            console.log("📂 Detected Adshares factory source");
        }
    }

    if (!lockLog) {
        console.log("❌ No lock event found");
        return null;
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash || sentTxs.has(txHash)) {
        console.log(`⏩ Skipping duplicate or missing txHash: ${txHash}`);
        return null;
    }
    sentTxs.add(txHash);

    const eventName = lockLog.resolvedEvent || "Unknown";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];

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

    console.log(`🎯 Final result: Chain=${chain.name}, Source=${source}, Type=${type}, Event=${eventName}`);

    return { chain, type, source, explorerLink, txHash };
}

// -----------------------------------------
// Main Webhook Handler
// -----------------------------------------
module.exports = async (req, res) => {
    try {
        if (req.method !== "POST") return res.status(200).json({ ok: true });
        
        const body = req.body || {};
        console.log("🚀 Full incoming body:", JSON.stringify(body, null, 2));
        
        if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
        
        const lockResult = detectLock(body);
        
        if (!lockResult) {
            console.log("❌ No matching lock detected");
            return res.status(200).json({ ok: true, note: "No lock event detected" });
        }
        
        const { chain, type, source, explorerLink, txHash } = lockResult;
        
        console.log(`✅ Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
        
        // Extract enhanced token data
        const tokenData = await extractTokenDataFromLogs(body, lockResult);
        console.log('💎 Enhanced token data extracted:', tokenData);
        
        // Send to dashboard with enhanced data
        const dashboardResult = await sendToDashboard(lockResult, body, tokenData);
        
        // Handle Telegram notification
        let telegramSent = false;
        
        console.log("📌 TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
        console.log("📌 TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
        
        if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
            console.log("❌ Missing Telegram credentials");
        } else {
            try {
                const parts = [
                    "🔒 *New Lock Created*",
                    `🌐 Chain: ${chain.name}`,
                    `📌 Type: ${type}`,
                    `🔖 Source: ${source}`
                ];

                // Add token information if available
                if (tokenData.symbol !== 'UNKNOWN') {
                    parts.push(`🪙 Token: ${tokenData.symbol}`);
                    
                    if (tokenData.amount > 0) {
                        parts.push(`💰 Amount: ${tokenData.amount.toLocaleString()} tokens`);
                    }
                    
                    if (tokenData.priceAtLock > 0) {
                        parts.push(`💵 Price: $${tokenData.priceAtLock.toFixed(6)}`);
                    }
                    
                    if (tokenData.usdValue > 0) {
                        parts.push(`💸 USD Value: $${tokenData.usdValue.toLocaleString()}`);
                    }
                }

                parts.push(`🔗 [View Transaction](${explorerLink})`);
                const message = parts.join("\n");
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_GROUP_CHAT_ID,
                    message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
                    text: message,
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                });
                
                console.log("📤 Enhanced Telegram message sent:", message);
                telegramSent = true;
                
            } catch (telegramError) {
                console.error("❌ Telegram sending error:", telegramError.message);
            }
        }
        
        return res.status(200).json({ 
            status: "processed",
            lockDetected: true,
            txHash: txHash,
            dashboardSent: !!dashboardResult,
            telegramSent: telegramSent,
            tokenData: tokenData
        });
        
    } catch (err) {
        console.error("❌ Webhook error:", err.message, err.stack);
        return res.status(200).json({ ok: true, error: err.message });
    }
};
