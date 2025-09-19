const axios = require("axios");
const { keccak256 } = require("js-sha3");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// Enhanced token symbol fetching using multiple methods
async function getTokenSymbolFromContract(tokenAddress, chainId) {
    try {
        console.log(`Fetching symbol for ${tokenAddress} on chain ${chainId}`);
        
        // Method 1: Check if this is an LP token and get proper LP symbol
        const lpInfo = await analyzeLPToken(tokenAddress, chainId);
        if (lpInfo.isLP && lpInfo.token0Symbol && lpInfo.token1Symbol) {
            const lpSymbol = `${lpInfo.token0Symbol}/${lpInfo.token1Symbol}`;
            console.log(`LP symbol constructed: ${lpSymbol}`);
            return lpSymbol;
        }
        
        // Method 2: Try CoinGecko token info API for regular tokens
        const coinGeckoSymbol = await getSymbolFromCoinGecko(tokenAddress, chainId);
        if (coinGeckoSymbol) {
            console.log(`Symbol from CoinGecko: ${coinGeckoSymbol}`);
            return coinGeckoSymbol;
        }
        
        // Method 3: Try DexScreener for token symbol
        const dexScreenerSymbol = await getDexScreenerTokenSymbol(tokenAddress, chainId);
        if (dexScreenerSymbol) {
            console.log(`Symbol from DexScreener: ${dexScreenerSymbol}`);
            return dexScreenerSymbol;
        }
        
        // Method 4: Fallback - if LP analysis detected it as LP but couldn't get symbols
        if (lpInfo.isLP) {
            console.log(`Detected as LP but no symbols found, using generic LP`);
            return 'LP-TOKEN';
        }
        
        console.log(`Could not get symbol for ${tokenAddress}`);
        return 'UNKNOWN';
        
    } catch (error) {
        console.error('Error getting token symbol:', error);
        return 'UNKNOWN';
    }
}

// Get token symbol from DexScreener
async function getDexScreenerTokenSymbol(tokenAddress, chainId) {
    try {
        const chainMap = {
            '1': 'ethereum',
            '56': 'bsc',
            '137': 'polygon',
            '8453': 'base'
        };

        const chain = chainMap[chainId];
        if (!chain) return null;

        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs?.filter(pair => pair.chainId === chain);
        if (pairs && pairs.length > 0) {
            const bestPair = pairs.sort((a, b) => 
                parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
            )[0];
            
            if (bestPair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()) {
                return bestPair.baseToken.symbol;
            }
            if (bestPair.quoteToken?.address?.toLowerCase() === tokenAddress.toLowerCase()) {
                return bestPair.quoteToken.symbol;
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Get symbol from CoinGecko
async function getSymbolFromCoinGecko(tokenAddress, chainId) {
    try {
        const platformMap = {
            '1': 'ethereum',
            '56': 'binance-smart-chain',
            '137': 'polygon-pos',
            '8453': 'base'
        };
        
        const platform = platformMap[chainId];
        if (!platform) return null;
        
        const response = await axios.get(
            `https://api.coingecko.com/api/v3/coins/${platform}/contract/${tokenAddress}`,
            { timeout: 5000 }
        );
        
        return response.data?.symbol?.toUpperCase();
        
    } catch (error) {
        console.log(`No CoinGecko data for ${tokenAddress}`);
        return null;
    }
}

// Enhanced LP token analysis and price fetching
async function getTokenPrice(tokenAddress, chainId) {
    try {
        console.log(`Fetching price for ${tokenAddress} on chain ${chainId}`);
        
        const lpInfo = await analyzeLPToken(tokenAddress, chainId);
        if (lpInfo.isLP) {
            console.log(`Detected LP token: ${lpInfo.token0Symbol}/${lpInfo.token1Symbol}`);
            
            if (lpInfo.token0Address && lpInfo.token1Address) {
                console.log(`Getting prices for underlying tokens...`);
                const [token0Price, token1Price] = await Promise.all([
                    getRegularTokenPrice(lpInfo.token0Address, chainId),
                    getRegularTokenPrice(lpInfo.token1Address, chainId)
                ]);
                
                if (token0Price || token1Price) {
                    const price = token0Price || token1Price;
                    console.log(`LP underlying token price: ${price}`);
                    return price;
                }
            }
            
            console.log(`LP token detected but no underlying token prices available`);
            return null;
        }
        
        return await getRegularTokenPrice(tokenAddress, chainId);
        
    } catch (error) {
        console.error(`Error fetching price for ${tokenAddress}:`, error.message);
        return null;
    }
}

// Analyze if token is an LP token and get underlying tokens
async function analyzeLPToken(tokenAddress, chainId) {
    try {
        console.log(`Analyzing if ${tokenAddress} is an LP token...`);
        
        const dexScreenerLP = await checkDexScreenerForLP(tokenAddress, chainId);
        if (dexScreenerLP.isLP) {
            return dexScreenerLP;
        }
        
        return { isLP: false };
        
    } catch (error) {
        console.log(`Error analyzing LP token: ${error.message}`);
        return { isLP: false };
    }
}

// Check DexScreener to see if this address appears as a pair contract
async function checkDexScreenerForLP(tokenAddress, chainId) {
    try {
        const chainMap = {
            '1': 'ethereum',
            '56': 'bsc',
            '137': 'polygon',
            '8453': 'base'
        };

        const chain = chainMap[chainId];
        if (!chain) return { isLP: false };

        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/pairs/${chain}/${tokenAddress}`,
            { timeout: 5000 }
        );

        if (response.data?.pair) {
            const pair = response.data.pair;
            console.log(`Found LP pair: ${pair.baseToken?.symbol}/${pair.quoteToken?.symbol}`);
            
            return {
                isLP: true,
                token0Address: pair.baseToken?.address,
                token1Address: pair.quoteToken?.address,
                token0Symbol: pair.baseToken?.symbol,
                token1Symbol: pair.quoteToken?.symbol,
                pairInfo: pair
            };
        }

        return { isLP: false };
        
    } catch (error) {
        console.log(`DexScreener LP check failed: ${error.message}`);
        return { isLP: false };
    }
}

// Get price for regular (non-LP) tokens
async function getRegularTokenPrice(tokenAddress, chainId) {
    try {
        console.log(`Fetching regular token price for ${tokenAddress}`);

        const dexScreenerPrice = await getDexScreenerPrice(tokenAddress, chainId);
        if (dexScreenerPrice) {
            console.log(`Price from DexScreener: ${dexScreenerPrice}`);
            return dexScreenerPrice;
        }
        
        const dexToolsPrice = await getDexToolsPrice(tokenAddress, chainId);
        if (dexToolsPrice) {
            console.log(`Price from DexTools: ${dexToolsPrice}`);
            return dexToolsPrice;
        }
        
        const coinGeckoPrice = await getCoinGeckoPrice(tokenAddress, chainId);
        if (coinGeckoPrice) {
            console.log(`Price from CoinGecko: ${coinGeckoPrice}`);
            return coinGeckoPrice;
        }
        
        console.log(`No price data found for ${tokenAddress}`);
        return null;
        
    } catch (error) {
        console.error(`Error fetching regular token price: ${error.message}`);
        return null;
    }
}

// DexScreener API - best for new tokens
async function getDexScreenerPrice(tokenAddress, chainId) {
    try {
        const chainMap = {
            '1': 'ethereum',
            '56': 'bsc',
            '137': 'polygon',
            '8453': 'base'
        };

        const chain = chainMap[chainId];
        if (!chain) return null;

        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            { timeout: 5000 }
        );

        const pairs = response.data?.pairs?.filter(pair => 
            pair.chainId === chain && pair.priceUsd
        );

        if (pairs && pairs.length > 0) {
            const bestPair = pairs.sort((a, b) => 
                parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
            )[0];
            
            return parseFloat(bestPair.priceUsd);
        }

        return null;
        
    } catch (error) {
        console.log(`No DexScreener data for ${tokenAddress}: ${error.message}`);
        return null;
    }
}

// DexTools API - second option
async function getDexToolsPrice(tokenAddress, chainId) {
    try {
        const chainMap = {
            '1': 'ether',
            '56': 'bnb', 
            '137': 'polygon',
            '8453': 'base'
        };

        const chain = chainMap[chainId];
        if (!chain) return null;

        try {
            const response = await axios.get(
                `https://www.dextools.io/shared/data/pair?chain=${chain}&address=${tokenAddress}`,
                { 
                    timeout: 5000,
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (compatible; DexBot/1.0)'
                    }
                }
            );

            if (response.data?.data?.price) {
                const price = parseFloat(response.data.data.price);
                console.log(`DexTools found price: ${price}`);
                return price;
            }
        } catch (apiError) {
            console.log(`DexTools API failed: ${apiError.message}`);
        }

        return null;
        
    } catch (error) {
        console.log(`No DexTools data for ${tokenAddress}: ${error.message}`);
        return null;
    }
}

// CoinGecko API - fallback for established tokens
async function getCoinGeckoPrice(tokenAddress, chainId) {
    try {
        const platformMap = {
            '1': 'ethereum',
            '56': 'binance-smart-chain',
            '137': 'polygon-pos',
            '8453': 'base'
        };

        const platform = platformMap[chainId];
        if (!platform) return null;

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
            console.log(`CoinGecko found price: ${price}`);
            return price;
        }

        return null;
        
    } catch (error) {
        console.log(`No CoinGecko data for ${tokenAddress}: ${error.message}`);
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

// Enhanced Team Finance extraction
async function extractTeamFinanceDataDebug(lockLog, lockResult, eventMap) {
    console.log('TEAM FINANCE EXTRACTION DEBUG');
    
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        if (eventMap[lockLog.topic0]) {
            const eventInfo = eventMap[lockLog.topic0];
            console.log('Found event definition:', eventInfo);
            
            if (eventInfo.name === 'DepositNFT' || eventInfo.name === 'Deposit') {
                if (lockLog.topic1) {
                    const tokenAddress = '0x' + lockLog.topic1.slice(-40).toLowerCase();
                    console.log(`Token address from topic1: ${tokenAddress}`);
                    
                    if (tokenAddress !== '0x0000000000000000000000000000000000000000') {
                        tokenData.address = tokenAddress;
                    }
                }
            }
        }

        // Fallback: Try topics parsing
        if (!tokenData.address && lockLog.topics && lockLog.topics.length > 1) {
            for (let i = 1; i < lockLog.topics.length; i++) {
                const topic = lockLog.topics[i];
                if (topic && topic.startsWith('0x') && topic.length === 66) {
                    const possibleAddress = '0x' + topic.slice(-40).toLowerCase();
                    
                    if (possibleAddress !== '0x0000000000000000000000000000000000000000' && 
                        possibleAddress.match(/^0x[a-f0-9]{40}$/)) {
                        if (!tokenData.address) tokenData.address = possibleAddress;
                    }
                }
            }
        }

        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            
            const symbol = await getTokenSymbolFromContract(tokenData.address, chainId);
            const price = await getTokenPrice(tokenData.address, chainId);
            
            if (symbol && symbol !== 'UNKNOWN') {
                tokenData.symbol = symbol;
            }
            
            if (price) {
                tokenData.priceAtLock = price;
                tokenData.usdValue = price;
            }
        }

        console.log('Final Team Finance token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('Team Finance extraction error:', error);
        return tokenData;
    }
}

// Enhanced UNCX extraction
async function extractUNCXDataDebug(lockLog, lockResult, eventMap) {
    console.log('UNCX EXTRACTION DEBUG');
    
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        // Fallback data extraction
        if (lockLog.data) {
            const data = lockLog.data.slice(2);
            if (data.length >= 128) {
                const lpTokenSlot = '0x' + data.slice(64, 128);
                const possibleAddress = '0x' + lpTokenSlot.slice(-40).toLowerCase();
                
                if (possibleAddress !== '0x0000000000000000000000000000000000000000' && 
                    possibleAddress.match(/^0x[a-f0-9]{40}$/)) {
                    tokenData.address = possibleAddress;
                }
            }
        }

        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            
            const symbol = await getTokenSymbolFromContract(tokenData.address, chainId);
            const price = await getTokenPrice(tokenData.address, chainId);
            
            if (symbol && symbol !== 'UNKNOWN') {
                tokenData.symbol = symbol;
            } else {
                tokenData.symbol = 'LP-TOKEN';
            }
            
            if (price) {
                tokenData.priceAtLock = price;
                tokenData.usdValue = price;
            }
        }

        console.log('Final UNCX token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('UNCX extraction error:', error);
        return tokenData;
    }
}

// Enhanced GoPlus extraction
async function extractGoPlusDataDebug(lockLog, lockResult) {
    console.log('GOPLUS EXTRACTION DEBUG');
    
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        if (lockLog.decoded && lockLog.decoded.inputs) {
            const inputs = lockLog.decoded.inputs;

            for (const input of inputs) {
                if (input.name === 'token' && input.value) {
                    tokenData.address = input.value.toLowerCase();
                }
                if (input.name === 'amount' && input.value) {
                    tokenData.amount = parseFloat(input.value) / Math.pow(10, 18);
                }
            }
        }

        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            
            const symbol = await getTokenSymbolFromContract(tokenData.address, chainId);
            const price = await getTokenPrice(tokenData.address, chainId);
            
            if (symbol) {
                tokenData.symbol = symbol;
            }
            
            if (price) {
                tokenData.priceAtLock = price;
                if (tokenData.amount > 0) {
                    tokenData.usdValue = tokenData.amount * price;
                }
            }
        }

        console.log('Final GoPlus token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('GoPlus extraction error:', error);
        return tokenData;
    }
}

// Main token extraction function
async function extractTokenDataFromLogs(body, lockResult, eventMap) {
    console.log('TOKEN EXTRACTION DEBUG START');
    
    const logs = Array.isArray(body.logs) ? body.logs : [];
    
    let tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        const lockLog = logs.find(log => {
            const addr = (log.address || "").toLowerCase();
            return KNOWN_LOCKERS.has(addr);
        });

        if (!lockLog) {
            console.log('NO LOCK LOG FOUND FOR TOKEN EXTRACTION');
            return tokenData;
        }

        const contractAddr = (lockLog.address || "").toLowerCase();
        
        if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) {
            tokenData = await extractTeamFinanceDataDebug(lockLog, lockResult, eventMap);
        } else if (UNCX_CONTRACTS[contractAddr]) {
            tokenData = await extractUNCXDataDebug(lockLog, lockResult, eventMap);
        } else if (GOPLUS_CONTRACTS[contractAddr]) {
            tokenData = await extractGoPlusDataDebug(lockLog, lockResult);
        }

        console.log('FINAL TOKEN EXTRACTION RESULT:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('Error in token extraction:', error);
        return tokenData;
    }
}

// Dashboard integration
async function sendToDashboard(lockResult, body, tokenData, req) {
    try {
        const dashboardData = {
            ...lockResult,
            contractAddress: body.logs?.find(log => log.address)?.address,
            eventName: 'Lock Created',
            blockNumber: body.txs?.[0]?.blockNumber,
            gasUsed: body.txs?.[0]?.gasUsed,
            timestamp: new Date().toISOString(),
            tokenAddress: tokenData.address,
            tokenSymbol: tokenData.symbol,
            tokenAmount: tokenData.amount,
            tokenPriceAtLock: tokenData.priceAtLock,
            usdValueAtLock: tokenData.usdValue
        };
        
        const dashboardUrl = `https://${req.headers.host}/api/locks`;

        const response = await axios.post(dashboardUrl, dashboardData, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Lock sent to dashboard:', lockResult.txHash);
        return response.data;
        
    } catch (error) {
        console.error('Failed to send to dashboard:', error.message);
        return null;
    }
}

// Shared Detection Logic
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

// ENHANCED: PBTC detection constants
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();
const PBTC_DEPLOY_METHOD_ID = "0xce84399a";
const PBTC_RELATED_ADDRESSES = new Set([
    "0xad7c34923db6f834ad48474acc4e0fc2476bf23f",
    "0xd95a366a2c887033ba71743c6342e2df470e9db9",
]);
const PBTC_TARGET_CONTRACTS = new Set([
    "0x7feccc5e213b61a825cc5f417343e013509c8746",
]);

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

// ENHANCED: PBTC detection function
function isPbtcTransaction(body, fromAddress, chainId) {
    console.log(`PBTC Detection - Chain ID: ${chainId}, From: ${fromAddress}`);
    
    if (chainId !== "8453") {
        console.log(`Not Base chain, skipping PBTC detection`);
        return false;
    }
    
    // Check 1: Known PBTC proxy address
    if (fromAddress === "0xd95a366a2c887033ba71743c6342e2df470e9db9") {
        console.log(`PBTC detected via known proxy address`);
        return true;
    }
    
    // Check 2: PBTC target contract in transactions
    const txs = Array.isArray(body.txs) ? body.txs : [];
    for (const tx of txs) {
        if (tx.to && tx.to.toLowerCase() === "0x7feccc5e213b61a825cc5f417343e013509c8746") {
            console.log(`PBTC detected via target contract: ${tx.to}`);
            return true;
        }
    }
    
    // Check 3: Adshares involvement
    const logs = Array.isArray(body.logs) ? body.logs : [];
    for (const log of logs) {
        const logStr = JSON.stringify(log).toLowerCase();
        if (logStr.includes('adshares') || logStr.includes('"ads"')) {
            console.log(`PBTC detected via Adshares involvement`);
            return true;
        }
    }
    
    // Check 4: Original PBTC wallet check
    if (fromAddress === PBTC_WALLET) {
        console.log(`PBTC detected via original wallet`);
        return true;
    }
    
    // Check 5: PBTC deploy method
    for (const tx of txs) {
        if (tx.input && tx.input.startsWith(PBTC_DEPLOY_METHOD_ID)) {
            console.log(`PBTC detected via deploy method`);
            return true;
        }
    }
    
    console.log(`PBTC not detected`);
    return false;
}

function detectLock(body) {
    console.log('LOCK DETECTION DEBUG START');
    
    if (!body.chainId) return null;
    const chainId = toDecChainId(body.chainId);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
    const logs = Array.isArray(body.logs) ? body.logs : [];

    console.log(`Processing chain: ${chain.name} (${chainId})`);
    console.log(`Processing ${logs.length} logs`);

    // ENHANCED: PBTC PRE-CHECK
    let forcePBTC = false;
    if (chainId === "8453") {
        const txs = Array.isArray(body.txs) ? body.txs : [];
        const allFromAddresses = [
            body.txs?.[0]?.from,
            body.from,
            ...txs.map(tx => tx.from),
            ...logs.map(log => log.from)
        ].filter(addr => addr).map(addr => addr.toLowerCase());

        console.log(`PBTC PRE-CHECK - All from addresses:`, allFromAddresses);

        if (allFromAddresses.includes("0xd95a366a2c887033ba71743c6342e2df470e9db9")) {
            forcePBTC = true;
            console.log(`PBTC FORCE-DETECTED via from address match`);
        }

        const allToAddresses = txs.map(tx => tx.to).filter(addr => addr).map(addr => addr.toLowerCase());
        if (allToAddresses.includes("0x7feccc5e213b61a825cc5f417343e013509c8746")) {
            forcePBTC = true;
            console.log(`PBTC FORCE-DETECTED via to address match`);
        }

        const bodyStr = JSON.stringify(body).toLowerCase();
        if (bodyStr.includes('adshares') || bodyStr.includes('"ads"')) {
            forcePBTC = true;
            console.log(`PBTC FORCE-DETECTED via Adshares involvement`);
        }

        console.log(`Final PBTC force decision: ${forcePBTC}`);
    }

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
    const fromAddress = (body.txs?.[0]?.from || "").toLowerCase();
    
    // Set isPbtcInitiated based on force decision or original detection
    let isPbtcInitiated = forcePBTC;
    if (!isPbtcInitiated) {
        isPbtcInitiated = isPbtcTransaction(body, fromAddress, chainId);
    }

    console.log(`From address: ${fromAddress}`);
    console.log(`PBTC initiated: ${isPbtcInitiated}`);

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
        
        console.log(`Log[${i}]: addr=${addr}, event=${ev || "N/A"}, known=${isKnown}, lockEvent=${isLockEvent}`);
        
        // ENHANCED: Priority 1 - If PBTC transaction, prioritize any lock event
        if (isPbtcInitiated && isKnown && isLockEvent) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`PBTC priority lock detected: ${ev} from ${addr}`);
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
        
        if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
            isAdshareSource = true;
            console.log("Detected Adshares factory source");
        }
    }

    if (!lockLog) {
        console.log("No lock event found in detection");
        return null;
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash || sentTxs.has(txHash)) {
        console.log(`Skipping duplicate or missing txHash: ${txHash}`);
        return null;
    }
    sentTxs.add(txHash);

    const eventName = lockLog.resolvedEvent || "Unknown";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];

    // ENHANCED: PBTC source assignment
    let source;
    if (isPbtcInitiated) {
        source = "PBTC";
        console.log(`Source FORCED to PBTC`);
    } else if (isTeamFinance) {
        source = isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance";
    } else if (isGoPlus) {
        source = "GoPlus";
    } else if (uncxVersion) {
        source = "UNCX";
    } else {
        source = "Unknown";
    }

    // ENHANCED: PBTC type assignment
    let type = "Unknown";
    if (isPbtcInitiated) {
        type = "V3 Token"; // PBTC is ALWAYS V3
        console.log(`Type FORCED to V3 Token (PBTC detected)`);
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

    console.log(`Final detection result: Chain=${chain.name}, Source=${source}, Type=${type}, Event=${eventName}`);
    console.log('LOCK DETECTION DEBUG END');

    return { chain, type, source, explorerLink, txHash, eventMap };
}

// Main Webhook Handler
module.exports = async (req, res) => {
    console.log('WEBHOOK HANDLER DEBUG START');
    console.log('Method:', req.method);
    
    try {
        if (req.method !== "POST") return res.status(200).json({ ok: true });
        
        const body = req.body || {};
        console.log("Full incoming body keys:", Object.keys(body));
        
        if (!body.chainId) {
            console.log('No chainId found - validation ping');
            return res.status(200).json({ ok: true, note: "Validation ping" });
        }
        
        const lockResult = detectLock(body);
        
        if (!lockResult) {
            console.log("No matching lock detected");
            return res.status(200).json({ ok: true, note: "No lock event detected" });
        }
        
        const { chain, type, source, explorerLink, txHash, eventMap } = lockResult;
        
        console.log(`Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
        
        // Extract enhanced token data
        console.log('Starting token data extraction...');
        const tokenData = await extractTokenDataFromLogs(body, lockResult, eventMap);
        console.log('Enhanced token data extracted:', tokenData);
        
        // Send to dashboard
        console.log('Sending to dashboard...');
        const dashboardResult = await sendToDashboard(lockResult, body, tokenData, req);
        console.log('Dashboard result:', dashboardResult ? 'Success' : 'Failed');
        
        // FIXED: Handle Telegram notification with proper token check
        let telegramSent = false;
        
        console.log("TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
        console.log("TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
        
        if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
            console.log("Missing Telegram credentials");
        } else {
            try {
                console.log('Preparing Telegram message...');
                
                const parts = [
                    "🔒 *New Lock Created*",
                    `🌐 Chain: ${chain.name}`,
                    `📌 Type: ${type}`,
                    `🔖 Source: ${source}`
                ];

                // FIXED: Only add token information if meaningful data exists
                if (tokenData.symbol && tokenData.symbol !== 'UNKNOWN') {
                    parts.push(`🪙 Token: ${tokenData.symbol}`);
                    
                    if (tokenData.amount > 0) {
                        parts.push(`💰 Amount: ${tokenData.amount.toLocaleString()} tokens`);
                    }
                    
                    if (tokenData.priceAtLock > 0) {
                        parts.push(`💵 Price: ${tokenData.priceAtLock.toFixed(6)}`);
                    }
                    
                    if (tokenData.usdValue > 0) {
                        parts.push(`💸 USD Value: ${tokenData.usdValue.toLocaleString()}`);
                    }
                }
                // FIXED: No "Token: UNKNOWN" line will be shown

                parts.push(`🔗 [View Transaction](${explorerLink})`);
                const message = parts.join("\n");
                
                console.log('Telegram message prepared:', message);
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_GROUP_CHAT_ID,
                    message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
                    text: message,
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                });
                
                console.log("Enhanced Telegram message sent successfully");
                telegramSent = true;
                
            } catch (telegramError) {
                console.error("Telegram sending error:", telegramError.message);
                console.error("Telegram error details:", telegramError.response?.data);
            }
        }
        
        const finalResult = { 
            status: "processed",
            lockDetected: true,
            txHash: txHash,
            dashboardSent: !!dashboardResult,
            telegramSent: telegramSent,
            tokenData: tokenData,
            debugInfo: {
                chain: chain.name,
                source: source,
                type: type,
                eventMapSize: Object.keys(eventMap).length,
                logsProcessed: body.logs?.length || 0
            }
        };
        
        console.log('WEBHOOK HANDLER FINAL RESULT');
        console.log('Final response:', JSON.stringify(finalResult, null, 2));
        console.log('WEBHOOK HANDLER DEBUG END');
        
        return res.status(200).json(finalResult);
        
    } catch (err) {
        console.error("Webhook error:", err.message);
        console.error("Webhook error stack:", err.stack);
        return res.status(200).json({ ok: true, error: err.message });
    }
};
