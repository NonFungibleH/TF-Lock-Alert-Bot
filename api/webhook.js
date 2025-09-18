const axios = require("axios");
const { keccak256 } = require("js-sha3");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// -----------------------------------------
// Enhanced Token Data Extraction Functions
// -----------------------------------------

// Enhanced token symbol fetching using multiple methods
async function getTokenSymbolFromContract(tokenAddress, chainId) {
    try {
        console.log(`🏷️ Fetching symbol for ${tokenAddress} on chain ${chainId}`);
        
        // Method 1: Try CoinGecko token info API
        const coinGeckoSymbol = await getSymbolFromCoinGecko(tokenAddress, chainId);
        if (coinGeckoSymbol) {
            console.log(`✅ Symbol from CoinGecko: ${coinGeckoSymbol}`);
            return coinGeckoSymbol;
        }
        
        // Method 2: For LP tokens, try to construct symbol
        const lpSymbol = await constructLPSymbol(tokenAddress, chainId);
        if (lpSymbol) {
            console.log(`✅ Constructed LP symbol: ${lpSymbol}`);
            return lpSymbol;
        }
        
        console.log(`❌ Could not get symbol for ${tokenAddress}`);
        return 'UNKNOWN';
        
    } catch (error) {
        console.error('❌ Error getting token symbol:', error);
        return 'UNKNOWN';
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

// Construct LP token symbol
async function constructLPSymbol(tokenAddress, chainId) {
    try {
        // This is a simplified version - in practice you'd need to:
        // 1. Check if it's an LP token by calling pair contract
        // 2. Get token0 and token1 addresses
        // 3. Get symbols for both tokens
        // 4. Construct "TOKEN0/TOKEN1 LP"
        
        // For now, return a generic LP symbol
        return 'LP-TOKEN';
        
    } catch (error) {
        return null;
    }
}

// Enhanced price fetching with multiple sources
async function getTokenPrice(tokenAddress, chainId) {
    try {
        console.log(`💰 Fetching price for ${tokenAddress} on chain ${chainId}`);

        // Try DexScreener first (best for new tokens)
        const dexScreenerPrice = await getDexScreenerPrice(tokenAddress, chainId);
        if (dexScreenerPrice) {
            console.log(`✅ Price from DexScreener: ${dexScreenerPrice}`);
            return dexScreenerPrice;
        }
        
        // Try DexTools second
        const dexToolsPrice = await getDexToolsPrice(tokenAddress, chainId);
        if (dexToolsPrice) {
            console.log(`✅ Price from DexTools: ${dexToolsPrice}`);
            return dexToolsPrice;
        }
        
        // Fallback to CoinGecko for established tokens
        const coinGeckoPrice = await getCoinGeckoPrice(tokenAddress, chainId);
        if (coinGeckoPrice) {
            console.log(`✅ Price from CoinGecko: ${coinGeckoPrice}`);
            return coinGeckoPrice;
        }
        
        console.log(`❌ No price data found for ${tokenAddress}`);
        return null;
        
    } catch (error) {
        console.error(`❌ Error fetching price for ${tokenAddress}:`, error.message);
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

        console.log(`🔍 Checking DexScreener for ${tokenAddress} on ${chain}`);

        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            { timeout: 5000 }
        );

        // DexScreener returns multiple pairs, get the one with highest liquidity
        const pairs = response.data?.pairs?.filter(pair => 
            pair.chainId === chain && pair.priceUsd
        );

        if (pairs && pairs.length > 0) {
            // Sort by liquidity and take the highest
            const bestPair = pairs.sort((a, b) => 
                parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
            )[0];
            
            console.log(`📊 DexScreener found pair: ${bestPair.baseToken?.symbol}/${bestPair.quoteToken?.symbol}`);
            console.log(`📊 Liquidity: ${bestPair.liquidity?.usd || 'N/A'}`);
            
            return parseFloat(bestPair.priceUsd);
        }

        return null;
        
    } catch (error) {
        console.log(`No DexScreener data for ${tokenAddress}: ${error.message}`);
        return null;
    }
}

// DexTools API - second option with improved endpoint
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

        console.log(`🔍 Checking DexTools for ${tokenAddress} on ${chain}`);

        // Try DexTools public API first
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
                console.log(`📊 DexTools found price: ${price}`);
                return price;
            }
        } catch (apiError) {
            console.log(`DexTools API failed: ${apiError.message}`);
        }

        // Fallback: Try DexTools token info endpoint
        try {
            const tokenResponse = await axios.get(
                `https://www.dextools.io/shared/data/token?chain=${chain}&address=${tokenAddress}`,
                { 
                    timeout: 5000,
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (compatible; DexBot/1.0)'
                    }
                }
            );

            if (tokenResponse.data?.data?.price) {
                const price = parseFloat(tokenResponse.data.data.price);
                console.log(`📊 DexTools token endpoint found price: ${price}`);
                return price;
            }
        } catch (tokenError) {
            console.log(`DexTools token endpoint failed: ${tokenError.message}`);
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

        console.log(`🔍 Checking CoinGecko for ${tokenAddress} on ${platform}`);

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
            console.log(`📊 CoinGecko found price: ${price}`);
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

// DEBUG: Enhanced Team Finance extraction with detailed logging
async function extractTeamFinanceDataDebug(lockLog, lockResult, eventMap) {
    console.log('🏢 === TEAM FINANCE EXTRACTION DEBUG ===');
    console.log('🏢 Lock log received:', JSON.stringify(lockLog, null, 2));
    console.log('🏢 Event map keys:', Object.keys(eventMap));
    
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        // Method 1: Try event definition decoding
        if (eventMap[lockLog.topic0]) {
            const eventInfo = eventMap[lockLog.topic0];
            console.log('📋 Found event definition:', eventInfo);
            
            // For Team Finance events, check if it's DepositNFT or Deposit
            if (eventInfo.name === 'DepositNFT') {
                console.log('🎯 Processing DepositNFT - token address should be in topic1');
                
                // For DepositNFT: topic1 = tokenAddress (indexed), topic2 = withdrawalAddress (indexed)
                if (lockLog.topic1) {
                    const tokenAddress = '0x' + lockLog.topic1.slice(-40).toLowerCase();
                    console.log(`✅ DepositNFT token address from topic1: ${tokenAddress}`);
                    
                    if (tokenAddress !== '0x0000000000000000000000000000000000000000') {
                        tokenData.address = tokenAddress;
                        
                        // Also extract amount from data chunks if available
                        if (lockLog.data) {
                            const data = lockLog.data.slice(2);
                            const chunks = [];
                            for (let i = 0; i < data.length; i += 64) {
                                chunks.push('0x' + data.slice(i, i + 64));
                            }
                            console.log('📊 DepositNFT data chunks:', chunks);
                            
                            // Chunk[1] should be the amount for DepositNFT
                            if (chunks.length > 1) {
                                try {
                                    const amountWei = BigInt(chunks[1]);
                                    tokenData.amount = Number(amountWei) / Math.pow(10, 18);
                                    console.log(`✅ DepositNFT amount extracted: ${tokenData.amount}`);
                                } catch (error) {
                                    console.log('⚠️ Could not parse amount from DepositNFT');
                                }
                            }
                        }
                    }
                }
                
            } else if (eventInfo.name === 'Deposit') {
                console.log('🎯 Processing Deposit - token address should be in topic1');
                
                // For Deposit: topic1 = tokenAddress (indexed), topic2 = withdrawalAddress (indexed)
                if (lockLog.topic1) {
                    const tokenAddress = '0x' + lockLog.topic1.slice(-40).toLowerCase();
                    console.log(`✅ Deposit token address from topic1: ${tokenAddress}`);
                    
                    if (tokenAddress !== '0x0000000000000000000000000000000000000000') {
                        tokenData.address = tokenAddress;
                        
                        // Also extract amount from data chunks
                        if (lockLog.data) {
                            const data = lockLog.data.slice(2);
                            const chunks = [];
                            for (let i = 0; i < data.length; i += 64) {
                                chunks.push('0x' + data.slice(i, i + 64));
                            }
                            console.log('📊 Deposit data chunks:', chunks);
                            
                            // Chunk[1] should be the amount for Deposit
                            if (chunks.length > 1) {
                                try {
                                    const amountWei = BigInt(chunks[1]);
                                    tokenData.amount = Number(amountWei) / Math.pow(10, 18);
                                    console.log(`✅ Deposit amount extracted: ${tokenData.amount}`);
                                } catch (error) {
                                    console.log('⚠️ Could not parse amount from Deposit');
                                }
                            }
                        }
                    }
                }
                
            } else {
                console.log('🔍 Processing other Team Finance event - trying data chunks');
                
                if (lockLog.data) {
                    console.log('📊 Raw data length:', lockLog.data.length);
                    console.log('📊 Raw data:', lockLog.data);
                    
                    const data = lockLog.data.slice(2);
                    const chunks = [];
                    
                    for (let i = 0; i < data.length; i += 64) {
                        chunks.push('0x' + data.slice(i, i + 64));
                    }
                    
                    console.log('📊 Data chunks:', chunks);
                    
                    // Try to find token address in chunks
                    chunks.forEach((chunk, index) => {
                        if (chunk.length === 66) {
                            const possibleAddress = '0x' + chunk.slice(-40).toLowerCase();
                            console.log(`🔍 Chunk[${index}] possible address: ${possibleAddress}`);
                            
                            if (possibleAddress !== '0x0000000000000000000000000000000000000000' && 
                                possibleAddress.match(/^0x[a-f0-9]{40}$/)) {
                                console.log(`✅ Valid address found in chunk[${index}]: ${possibleAddress}`);
                                if (!tokenData.address) tokenData.address = possibleAddress;
                            }
                        }
                    });
                }
            }
        } else {
            console.log('❌ No event definition found for topic0:', lockLog.topic0);
        }

        // Method 2: Try topics parsing
        if (!tokenData.address && lockLog.topics && lockLog.topics.length > 1) {
            console.log('🔍 Trying topics parsing...');
            console.log('🔍 Available topics:', lockLog.topics);
            
            for (let i = 1; i < lockLog.topics.length; i++) {
                const topic = lockLog.topics[i];
                if (topic && topic.startsWith('0x') && topic.length === 66) {
                    const possibleAddress = '0x' + topic.slice(-40).toLowerCase();
                    console.log(`🔍 Topic[${i}] possible address: ${possibleAddress}`);
                    
                    if (possibleAddress !== '0x0000000000000000000000000000000000000000' && 
                        possibleAddress.match(/^0x[a-f0-9]{40}$/)) {
                        console.log(`✅ Valid address from topic[${i}]: ${possibleAddress}`);
                        if (!tokenData.address) tokenData.address = possibleAddress;
                    }
                }
            }
        }

        console.log('🎯 Team Finance extracted address:', tokenData.address);
        
        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            console.log('🌐 Getting token info for chain:', chainId);
            
            // Get symbol and price with detailed logging
            console.log('🏷️ Fetching symbol...');
            const symbol = await getTokenSymbolFromContract(tokenData.address, chainId);
            console.log('🏷️ Symbol result:', symbol);
            
            console.log('💰 Fetching price...');
            const price = await getTokenPrice(tokenData.address, chainId);
            console.log('💰 Price result:', price);
            
            if (symbol && symbol !== 'UNKNOWN') {
                tokenData.symbol = symbol;
            }
            
            if (price) {
                tokenData.priceAtLock = price;
                tokenData.usdValue = price; // Assuming 1 token for now
            }
        }

        console.log('🎯 Final Team Finance token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('❌ Team Finance extraction error:', error);
        console.error('❌ Stack:', error.stack);
        return tokenData;
    }
}

// DEBUG: Enhanced UNCX extraction with detailed logging
async function extractUNCXDataDebug(lockLog, lockResult, eventMap) {
    console.log('🔒 === UNCX EXTRACTION DEBUG ===');
    console.log('🔒 Lock log received:', JSON.stringify(lockLog, null, 2));
    console.log('🔒 Event map keys:', Object.keys(eventMap));
    
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        // Method 1: Try event definition decoding
        if (eventMap[lockLog.topic0]) {
            const eventInfo = eventMap[lockLog.topic0];
            console.log('📋 Found UNCX event definition:', eventInfo);
            
            if (eventInfo.name === 'onNewLock' && lockLog.data) {
                console.log('📊 Processing onNewLock event...');
                const decodedData = await decodeOnNewLockEvent(lockLog, eventInfo, lockResult);
                if (decodedData.address) {
                    Object.assign(tokenData, decodedData);
                }
            } else if (eventInfo.name === 'onDeposit' && lockLog.data) {
                console.log('📊 Processing onDeposit event...');
                const decodedData = await decodeOnDepositEvent(lockLog, eventInfo, lockResult);
                if (decodedData.address) {
                    Object.assign(tokenData, decodedData);
                }
            }
        } else {
            console.log('❌ No UNCX event definition found for topic0:', lockLog.topic0);
        }

        // Method 2: Fallback data extraction
        if (!tokenData.address && lockLog.data) {
            console.log('🔍 Trying fallback UNCX data extraction...');
            const data = lockLog.data.slice(2);
            if (data.length >= 128) {
                const lpTokenSlot = '0x' + data.slice(64, 128);
                const possibleAddress = '0x' + lpTokenSlot.slice(-40).toLowerCase();
                console.log('🔍 Fallback LP token extraction:', possibleAddress);
                
                if (possibleAddress !== '0x0000000000000000000000000000000000000000' && 
                    possibleAddress.match(/^0x[a-f0-9]{40}$/)) {
                    tokenData.address = possibleAddress;
                    console.log('✅ Fallback address found:', possibleAddress);
                }
            }
        }

        console.log('🎯 UNCX extracted address:', tokenData.address);
        
        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            console.log('🌐 Getting UNCX token info for chain:', chainId);
            
            const [symbol, price] = await Promise.all([
                getTokenSymbolFromContract(tokenData.address, chainId),
                getTokenPrice(tokenData.address, chainId)
            ]);
            
            console.log('🏷️ UNCX Symbol result:', symbol);
            console.log('💰 UNCX Price result:', price);
            
            if (symbol && symbol !== 'UNKNOWN') {
                tokenData.symbol = symbol;
            } else {
                tokenData.symbol = 'LP-TOKEN';
            }
            
            if (price) {
                tokenData.priceAtLock = price;
                if (tokenData.amount > 0) {
                    tokenData.usdValue = tokenData.amount * price;
                } else {
                    tokenData.usdValue = price; // Default to 1 token
                }
            }
        }

        console.log('🎯 Final UNCX token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('❌ UNCX extraction error:', error);
        console.error('❌ Stack:', error.stack);
        return tokenData;
    }
}

// DEBUG: Enhanced GoPlus extraction with detailed logging
async function extractGoPlusDataDebug(lockLog, lockResult) {
    console.log('🛡️ === GOPLUS EXTRACTION DEBUG ===');
    console.log('🛡️ Lock log received:', JSON.stringify(lockLog, null, 2));
    
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
            console.log('📋 GoPlus decoded inputs:', inputs);

            for (const input of inputs) {
                if (input.name === 'token' && input.value) {
                    tokenData.address = input.value.toLowerCase();
                    console.log('🎯 Found GoPlus token address:', tokenData.address);
                }
                if (input.name === 'amount' && input.value) {
                    tokenData.amount = parseFloat(input.value) / Math.pow(10, 18);
                    console.log('📊 Found GoPlus token amount:', tokenData.amount);
                }
            }
        }

        if (tokenData.address) {
            const chainId = getChainIdFromName(lockResult.chain.name);
            console.log('🌐 Getting GoPlus token info for chain:', chainId);
            
            const [symbol, price] = await Promise.all([
                getTokenSymbolFromContract(tokenData.address, chainId),
                getTokenPrice(tokenData.address, chainId)
            ]);
            
            console.log('🏷️ GoPlus Symbol result:', symbol);
            console.log('💰 GoPlus Price result:', price);
            
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

        console.log('🎯 Final GoPlus token data:', tokenData);
        return tokenData;

    } catch (error) {
        console.error('❌ GoPlus extraction error:', error);
        return tokenData;
    }
}

// Decode onNewLock event data
async function decodeOnNewLockEvent(lockLog, eventInfo, lockResult) {
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🎯 Decoding onNewLock event...');
        // onNewLock(uint256 lockID, address lpToken, address owner, uint256 amount, uint256 lockDate, uint256 unlockDate, uint16 countryCode)
        const data = lockLog.data.slice(2); // Remove 0x prefix
        const chunks = [];
        
        // Split into 32-byte chunks
        for (let i = 0; i < data.length; i += 64) {
            chunks.push('0x' + data.slice(i, i + 64));
        }
        
        console.log('📊 onNewLock data chunks:', chunks);
        
        if (chunks.length >= 6) {
            // Extract data based on event signature
            const lockID = parseInt(chunks[0], 16);
            const lpTokenHex = chunks[1];
            const ownerHex = chunks[2];
            const amountHex = chunks[3];
            const lockDateHex = chunks[4];
            const unlockDateHex = chunks[5];
            
            // Extract LP token address (remove padding)
            tokenData.address = '0x' + lpTokenHex.slice(-40).toLowerCase();
            
            // Extract amount (convert from wei, assuming 18 decimals)
            const amountWei = BigInt(amountHex);
            tokenData.amount = Number(amountWei) / Math.pow(10, 18);
            
            console.log('🎯 Decoded onNewLock:');
            console.log('  - Lock ID:', lockID);
            console.log('  - LP Token:', tokenData.address);
            console.log('  - Amount:', tokenData.amount);
            console.log('  - Lock Date:', new Date(parseInt(lockDateHex, 16) * 1000));
            console.log('  - Unlock Date:', new Date(parseInt(unlockDateHex, 16) * 1000));
        }
        
    } catch (error) {
        console.error('❌ Error decoding onNewLock:', error);
    }
    
    return tokenData;
}

// Decode onDeposit event data
async function decodeOnDepositEvent(lockLog, eventInfo, lockResult) {
    const tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        console.log('🎯 Decoding onDeposit event...');
        // onDeposit(address lpToken, address user, uint256 amount, uint256 lockDate, uint256 unlockDate)
        const data = lockLog.data.slice(2);
        const chunks = [];
        
        for (let i = 0; i < data.length; i += 64) {
            chunks.push('0x' + data.slice(i, i + 64));
        }
        
        console.log('📊 onDeposit data chunks:', chunks);
        
        if (chunks.length >= 5) {
            const lpTokenHex = chunks[0];
            const userHex = chunks[1];
            const amountHex = chunks[2];
            const lockDateHex = chunks[3];
            const unlockDateHex = chunks[4];
            
            tokenData.address = '0x' + lpTokenHex.slice(-40).toLowerCase();
            
            const amountWei = BigInt(amountHex);
            tokenData.amount = Number(amountWei) / Math.pow(10, 18);
            
            console.log('🎯 Decoded onDeposit:');
            console.log('  - LP Token:', tokenData.address);
            console.log('  - User:', '0x' + userHex.slice(-40));
            console.log('  - Amount:', tokenData.amount);
        }
        
    } catch (error) {
        console.error('❌ Error decoding onDeposit:', error);
    }
    
    return tokenData;
}

// DEBUG: Enhanced main token extraction function with detailed logging
async function extractTokenDataFromLogs(body, lockResult, eventMap) {
    console.log('🔍 === TOKEN EXTRACTION DEBUG START ===');
    console.log('📦 Body keys:', Object.keys(body));
    console.log('📦 LockResult:', JSON.stringify(lockResult, null, 2));
    console.log('📦 EventMap entries:', Object.keys(eventMap).length);
    console.log('📦 EventMap:', eventMap);
    
    const logs = Array.isArray(body.logs) ? body.logs : [];
    console.log('📋 Total logs to process:', logs.length);
    
    let tokenData = {
        address: null,
        symbol: 'UNKNOWN',
        amount: 0,
        priceAtLock: 0,
        usdValue: 0
    };

    try {
        // Log each log in detail
        logs.forEach((log, index) => {
            console.log(`🔍 Log[${index}]:`, {
                address: log.address,
                topics: log.topics,
                data: log.data?.slice(0, 100) + '...', // Truncate for readability
                topic0: log.topics?.[0],
                eventName: log.name || log.eventName,
                decoded: log.decoded
            });
        });

        // Find the lock log by matching the contract address from the detection
        const lockLog = logs.find(log => {
            const addr = (log.address || "").toLowerCase();
            const isKnown = KNOWN_LOCKERS.has(addr);
            console.log(`🔍 Checking log with address ${addr} - Known locker: ${isKnown}`);
            return isKnown;
        });

        if (!lockLog) {
            console.log('❌ NO LOCK LOG FOUND FOR TOKEN EXTRACTION');
            console.log('📋 Known lockers:', Array.from(KNOWN_LOCKERS));
            console.log('📋 Log addresses found:', logs.map(l => l.address?.toLowerCase()));
            return tokenData;
        }

        console.log('✅ FOUND LOCK LOG FOR EXTRACTION:', JSON.stringify(lockLog, null, 2));

        // Extract token data based on platform
        const contractAddr = (lockLog.address || "").toLowerCase();
        console.log('🏢 Contract address:', contractAddr);
        console.log('🏢 Is Team Finance:', TEAM_FINANCE_CONTRACTS.has(contractAddr));
        console.log('🏢 Is UNCX:', !!UNCX_CONTRACTS[contractAddr]);
        console.log('🏢 Is GoPlus:', !!GOPLUS_CONTRACTS[contractAddr]);
        
        if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) {
            console.log('🏢 Processing as Team Finance...');
            tokenData = await extractTeamFinanceDataDebug(lockLog, lockResult, eventMap);
        } else if (UNCX_CONTRACTS[contractAddr]) {
            console.log('🔒 Processing as UNCX...');
            tokenData = await extractUNCXDataDebug(lockLog, lockResult, eventMap);
        } else if (GOPLUS_CONTRACTS[contractAddr]) {
            console.log('🛡️ Processing as GoPlus...');
            tokenData = await extractGoPlusDataDebug(lockLog, lockResult);
        } else {
            console.log('❌ Unknown contract type for address:', contractAddr);
        }

        console.log('🎯 FINAL TOKEN EXTRACTION RESULT:', tokenData);
        console.log('🔍 === TOKEN EXTRACTION DEBUG END ===');
        
        return tokenData;

    } catch (error) {
        console.error('❌ Error in token extraction:', error);
        console.error('❌ Stack trace:', error.stack);
        return tokenData;
    }
}

// -----------------------------------------
// Enhanced Dashboard Integration Function
// -----------------------------------------
async function sendToDashboard(lockResult, body, tokenData, req) {
    try {
        console.log('📊 === SENDING TO DASHBOARD ===');
        
        const dashboardData = {
            ...lockResult,
            // Extract additional data from the webhook body if available
            contractAddress: body.logs?.find(log => log.address)?.address,
            eventName: 'Lock Created', // Simplified event name
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
        
        // Fixed dashboard URL using request host
        const dashboardUrl = `https://${req.headers.host}/api/locks`;
        
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

// Clear the sentTxs set periodically to prevent memory issues
// But keep recent transactions for at least 30 minutes to prevent duplicates
const sentTxsTimestamps = new Map();

setInterval(() => {
    const now = Date.now();
    const thirtyMinutesAgo = now - (30 * 60 * 1000); // 30 minutes ago
    
    // Remove transactions older than 30 minutes
    for (const [txHash, timestamp] of sentTxsTimestamps.entries()) {
        if (timestamp < thirtyMinutesAgo) {
            sentTxs.delete(txHash);
            sentTxsTimestamps.delete(txHash);
        }
    }
    
    console.log(`🧹 Cleaned old transactions. Current set size: ${sentTxs.size}`);
}, 600000); // Clean every 10 minutes

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
// PBTC detection constants - expanded for better coverage
const PBTC_WALLET = "0xaD7c34923db6f834Ad48474Acc4E0FC2476bF23f".toLowerCase();
const PBTC_DEPLOY_METHOD_ID = "0xce84399a";

// Additional PBTC patterns that might indicate PBTC transactions
const PBTC_RELATED_ADDRESSES = new Set([
    "0xad7c34923db6f834ad48474acc4e0fc2476bf23f", // Original PBTC wallet
    "0xd95a366a2c887033ba71743c6342e2df470e9db9", // Proxy/deployer contract (confirmed from transactions)
]);

const PBTC_TARGET_CONTRACTS = new Set([
    "0x7feccc5e213b61a825cc5f417343e013509c8746", // Target deployment contract (confirmed from transactions)
]);

// Adshares token patterns - PBTC transactions often involve ADS tokens
const ADSHARES_PATTERNS = [
    "adshares",
    "ads",
    "0x6e57f6967c2476bf23f", // Add actual ADS token address when confirmed
];

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
    console.log(`🔍 === PBTC DETECTION DEBUG START ===`);
    console.log(`🔍 Chain ID: ${chainId}, From: ${fromAddress}`);
    
    // Only check on Base chain
    if (chainId !== "8453") {
        console.log(`🔍 Not Base chain, skipping PBTC detection`);
        return false;
    }
    
    // CRITICAL: Check the exact pattern from failing transactions
    const isKnownPbtcProxy = fromAddress === "0xd95a366a2c887033ba71743c6342e2df470e9db9";
    console.log(`🔍 PBTC proxy check: ${isKnownPbtcProxy}`);
    
    if (isKnownPbtcProxy) {
        console.log(`✅ PBTC detected via known proxy address`);
        return true;
    }
    
    // Check for PBTC target contract in transactions
    const txs = Array.isArray(body.txs) ? body.txs : [];
    for (const tx of txs) {
        if (tx.to && tx.to.toLowerCase() === "0x7feccc5e213b61a825cc5f417343e013509c8746") {
            console.log(`✅ PBTC detected via target contract: ${tx.to}`);
            return true;
        }
    }
    
    // Check for Adshares involvement in token transfers
    const logs = Array.isArray(body.logs) ? body.logs : [];
    for (const log of logs) {
        const logStr = JSON.stringify(log).toLowerCase();
        if (logStr.includes('adshares') || logStr.includes('"ads"')) {
            console.log(`✅ PBTC detected via Adshares involvement`);
            return true;
        }
    }
    
    // Original PBTC wallet check
    if (fromAddress === PBTC_WALLET) {
        console.log(`✅ PBTC detected via original wallet`);
        return true;
    }
    
    console.log(`❌ PBTC not detected`);
    console.log(`🔍 === PBTC DETECTION DEBUG END ===`);
    return false;
}

function detectLock(body) {
    console.log('🔍 === LOCK DETECTION DEBUG START ===');
    console.log('📦 Received body for detection:', JSON.stringify(body, null, 2));
    
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
        console.log('🗺️ Event signatures:', Object.values(eventMap).map(e => e.signature));
    }

    let lockLog = null;
    let isAdshareSource = false;
    const fromAddress = (body.txs?.[0]?.from || body.from || "").toLowerCase();
    const isPbtcInitiated = isPbtcTransaction(body, fromAddress, chainId);

    console.log(`👤 From address: ${fromAddress}`);
    console.log(`🅿️ PBTC wallet: ${PBTC_WALLET}`);
    console.log(`🅿️ PBTC initiated: ${isPbtcInitiated}`);
    console.log(`🌐 Chain ID: ${chainId}`);
    
    // Show critical debugging info for failing cases
    console.log(`🔍 === CRITICAL DEBUG INFO ===`);
    console.log(`🔍 Exact from address: "${fromAddress}"`);
    console.log(`🔍 Expected PBTC proxy: "0xd95a366a2c887033ba71743c6342e2df470e9db9"`);
    console.log(`🔍 From address match: ${fromAddress === "0xd95a366a2c887033ba71743c6342e2df470e9db9"}`);
    
    // If PBTC was detected, show why
    if (isPbtcInitiated) {
        console.log(`🎉 PBTC TRANSACTION CONFIRMED - Will override other source detection`);
    } else {
        console.log(`❌ PBTC NOT DETECTED - Transaction will be processed as other source`);
    }
    
    // Show transaction structure
    const txs = Array.isArray(body.txs) ? body.txs : [];
    txs.forEach((tx, i) => {
        console.log(`🔍 TX[${i}]: from=${tx.from}, to=${tx.to}`);
        if (tx.to === "0x7feccc5e213b61a825cc5f417343e013509c8746") {
            console.log(`🎯 Found PBTC target contract in TX[${i}]!`);
        }
    });

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
        
        // Priority 1: If this is a PBTC transaction, prioritize any lock event
        if (isPbtcInitiated && isKnown && isLockEvent) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`✅ PBTC priority lock detected: ${ev} from ${addr}`);
            break; // Exit early for PBTC to prevent override
        }
        
        // Priority 2: Standard lock detection (only if not PBTC)
        if (!isPbtcInitiated && isKnown && isLockEvent && !isGoPlusContract) {
            lockLog = { ...l, resolvedEvent: ev };
            console.log(`✅ Standard lock detected: ${ev} from ${addr}`);
        }
        
        // Priority 3: GoPlus detection (only if no other lock found)
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
        console.log("❌ No lock event found in detection");
        console.log('🔍 === LOCK DETECTION DEBUG END ===');
        return null;
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash || body.hash;
    if (!txHash) {
        console.log(`❌ No txHash found in lockLog or body`);
        console.log('🔍 === LOCK DETECTION DEBUG END ===');
        return null;
    }
    
    if (sentTxs.has(txHash)) {
        console.log(`⏩ Skipping duplicate txHash: ${txHash}`);
        console.log('🔍 === LOCK DETECTION DEBUG END ===');
        return null;
    }
    
    // Add to both the set and timestamp map
    sentTxs.add(txHash);
    sentTxsTimestamps.set(txHash, Date.now());

    const eventName = lockLog.resolvedEvent || "Unknown";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];

    let source;
    console.log(`🏷️ === SOURCE ASSIGNMENT DEBUG ===`);
    console.log(`🏷️ isPbtcInitiated: ${isPbtcInitiated}`);
    console.log(`🏷️ isTeamFinance: ${isTeamFinance}`);
    console.log(`🏷️ isGoPlus: ${!!isGoPlus}`);
    console.log(`🏷️ uncxVersion: ${uncxVersion || 'none'}`);
    console.log(`🏷️ isAdshareSource: ${isAdshareSource}`);
    
    if (isPbtcInitiated) {
        source = "PBTC";
        console.log(`✅ Source assigned: PBTC (due to isPbtcInitiated)`);
    } else if (isTeamFinance) {
        source = isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance";
        console.log(`✅ Source assigned: ${source} (due to isTeamFinance)`);
    } else if (isGoPlus) {
        source = "GoPlus";
        console.log(`✅ Source assigned: GoPlus (due to isGoPlus)`);
    } else if (uncxVersion) {
        source = "UNCX";
        console.log(`✅ Source assigned: UNCX (due to uncxVersion)`);
    } else {
        source = "Unknown";
        console.log(`⚠️ Source assigned: Unknown (no criteria met)`);
    }

    let type = "Unknown";
    if (isPbtcInitiated) {
        type = "V3 Token"; // Fixed: PBTC should be V3, not V2
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

    console.log(`🎯 Final detection result: Chain=${chain.name}, Source=${source}, Type=${type}, Event=${eventName}`);
    console.log('🔍 === LOCK DETECTION DEBUG END ===');

    return { chain, type, source, explorerLink, txHash, eventMap };
}

// -----------------------------------------
// Main Webhook Handler with Enhanced Debug Logging
// -----------------------------------------
module.exports = async (req, res) => {
    console.log('🚀 === WEBHOOK HANDLER DEBUG START ===');
    console.log('🌐 Method:', req.method);
    console.log('🌐 Headers:', JSON.stringify(req.headers, null, 2));
    
    try {
        if (req.method !== "POST") return res.status(200).json({ ok: true });
        
        const body = req.body || {};
        console.log("📦 Full incoming body keys:", Object.keys(body));
        console.log("📦 Full incoming body:", JSON.stringify(body, null, 2));
        
        if (!body.chainId) {
            console.log('❌ No chainId found - validation ping');
            return res.status(200).json({ ok: true, note: "Validation ping" });
        }
        
        const lockResult = detectLock(body);
        
        if (!lockResult) {
            console.log("❌ No matching lock detected");
            return res.status(200).json({ ok: true, note: "No lock event detected" });
        }
        
        const { chain, type, source, explorerLink, txHash, eventMap } = lockResult;
        
        console.log(`✅ Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
        
        // Extract enhanced token data with eventMap and enhanced debugging
        console.log('💎 Starting token data extraction...');
        const tokenData = await extractTokenDataFromLogs(body, lockResult, eventMap);
        console.log('💎 Enhanced token data extracted:', tokenData);
        
        // Send to dashboard with enhanced data and request object
        console.log('📊 Sending to dashboard...');
        const dashboardResult = await sendToDashboard(lockResult, body, tokenData, req);
        console.log('📊 Dashboard result:', dashboardResult ? 'Success' : 'Failed');
        
        // Handle Telegram notification with improved message format
        let telegramSent = false;
        
        console.log("📌 TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
        console.log("📌 TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
        
        if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
            console.log("❌ Missing Telegram credentials");
        } else {
            try {
                console.log('📱 Preparing Telegram message...');
                
                const parts = [
                    "🔒 *New Lock Created*",
                    `🌐 Chain: ${chain.name}`,
                    `📌 Type: ${type}`,
                    `🔖 Source: ${source}`
                ];

                // Only add token information if it's meaningful
                // Skip LP-TOKEN and zero amounts to clean up the message
                if (tokenData.symbol !== 'UNKNOWN' && 
                    tokenData.symbol !== 'LP-TOKEN' && 
                    tokenData.amount > 0) {
                    
                    parts.push(`🪙 Token: ${tokenData.symbol}`);
                    parts.push(`💰 Amount: ${tokenData.amount.toLocaleString()} tokens`);
                    
                    if (tokenData.priceAtLock > 0) {
                        parts.push(`💵 Price: ${tokenData.priceAtLock.toFixed(6)}`);
                    }
                    
                    if (tokenData.usdValue > 0) {
                        parts.push(`💸 USD Value: ${tokenData.usdValue.toLocaleString()}`);
                    }
                }

                parts.push(`🔗 [View Transaction](${explorerLink})`);
                const message = parts.join("\n");
                
                console.log('📱 Telegram message prepared:', message);
                
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_GROUP_CHAT_ID,
                    message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
                    text: message,
                    parse_mode: "Markdown",
                    disable_web_page_preview: true,
                });
                
                console.log("📤 Enhanced Telegram message sent successfully");
                telegramSent = true;
                
            } catch (telegramError) {
                console.error("❌ Telegram sending error:", telegramError.message);
                console.error("❌ Telegram error details:", telegramError.response?.data);
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
        
        console.log('🚀 === WEBHOOK HANDLER FINAL RESULT ===');
        console.log('🎯 Final response:', JSON.stringify(finalResult, null, 2));
        console.log('🚀 === WEBHOOK HANDLER DEBUG END ===');
        
        return res.status(200).json(finalResult);
        
    } catch (err) {
        console.error("❌ Webhook error:", err.message);
        console.error("❌ Webhook error stack:", err.stack);
        return res.status(200).json({ ok: true, error: err.message });
    }
};
