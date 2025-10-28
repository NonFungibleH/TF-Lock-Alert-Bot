const axios = require("axios");
const { ethers } = require("ethers");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// RPC endpoints - Use env vars first, then fallback to premium public RPCs
const RPC_URLS = {
  1: [
    process.env.ETHEREUM_RPC,
    "https://eth.llamarpc.com",
    "https://ethereum-rpc.publicnode.com",
    "https://eth.meowrpc.com",
    "https://eth.drpc.org"
  ].filter(Boolean),
  
  56: [
    process.env.BSC_RPC,
    "https://bsc.drpc.org",
    "https://bsc-rpc.publicnode.com",
    "https://bsc.meowrpc.com",
    "https://bsc-dataseed.bnbchain.org"
  ].filter(Boolean),
  
  137: [
    process.env.POLYGON_RPC,
    "https://polygon.drpc.org",
    "https://polygon-bor-rpc.publicnode.com",
    "https://1rpc.io/matic",
    "https://endpoints.omniatech.io/v1/matic/mainnet/public"
  ].filter(Boolean),
  
  8453: [
    process.env.BASE_RPC,
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://base.meowrpc.com",
    "https://endpoints.omniatech.io/v1/base/mainnet/public"
  ].filter(Boolean)
};

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

// All the helper functions from webhook.js
function extractTokenData(lockLog, eventName, source) {
  try {
    const topics = lockLog.topics || [];
    const topicsArray = topics.length > 0 ? topics : [
      lockLog.topic0,
      lockLog.topic1, 
      lockLog.topic2,
      lockLog.topic3
    ].filter(t => t !== null && t !== undefined);
    
    const data = lockLog.data || "0x";
    
    console.log(`Extracting token - Event: ${eventName}, Source: ${source}`);
    
    if (source === "Team Finance" && eventName === "Deposit") {
      const tokenAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      if (data.length >= 194) {
        const amountHex = data.slice(66, 130);
        const unlockHex = data.slice(130, 194);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V3", isLPLock: false, lpPosition: null };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3", isLPLock: false, lpPosition: null };
    }
    
    if (eventName === "onDeposit") {
      if (data.length >= 322) {
        const tokenAddress = `0x${data.slice(26, 66)}`;
        const amountHex = data.slice(130, 194);
        const unlockHex = data.slice(258, 322);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V2", isLPLock: false, lpPosition: null };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V2", isLPLock: false, lpPosition: null };
    }
    
    if (source === "Team Finance" && eventName === "DepositNFT") {
      const tokenAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      if (data.length >= 258) {
        const amountHex = data.slice(130, 194);
        const unlockHex = data.slice(194, 258);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V3", isLPLock: false, lpPosition: null };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3", isLPLock: false, lpPosition: null };
    }
    
    if (eventName === "DepositNFT") {
      const tokenAddress = topicsArray[2] ? `0x${topicsArray[2].slice(26)}` : null;
      if (data.length >= 130) {
        const amountHex = data.slice(2, 66);
        const unlockHex = data.slice(66, 130);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V3", isLPLock: false, lpPosition: null };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3", isLPLock: false, lpPosition: null };
    }
    
    if (eventName === "onLock" && source === "UNCX") {
      // UNCX V3 LP lock - data structure:
      // Offset 0-63: lock_id
      // Offset 64-127: nftPositionManager
      // Offset 128-191: nft_id
      // Offset 192-255: owner
      // Offset 256-319: additionalCollector
      // Offset 320-383: collectAddress
      // Offset 384-447: unlockDate ← THIS IS WHAT WE NEED
      // Offset 448-511: countryCode
      // Offset 512-575: collectFee
      // Offset 576-639: poolAddress
      // Offset 640+: position tuple
      //   - Offset 768-831: token0 ← THIS IS WHAT WE NEED
      //   - Offset 832-895: token1 ← THIS IS WHAT WE NEED
      
      if (data.length >= 896) {
        // Extract unlock time (offset 384, length 64 chars)
        const unlockHex = data.slice(386, 450); // 386 = 2 (for 0x) + 384
        const unlockTime = parseInt(unlockHex, 16);
        
        // Extract pool address (offset 576, last 40 chars of 64-char word)
        const poolAddress = `0x${data.slice(602, 642)}`; // 602 = 2 + 576 + 24
        
        // Extract token0 (offset 768, last 40 chars of 64-char word)
        const token0 = `0x${data.slice(794, 834)}`; // 794 = 2 + 768 + 24
        
        // Extract token1 (offset 832, last 40 chars of 64-char word)  
        const token1 = `0x${data.slice(858, 898)}`; // 858 = 2 + 832 + 24
        
        // Extract FULL LP position data
        const lpPosition = extractLPPositionData(lockLog);
        
        // Smart token selection: pick the non-wrapped native token
        const wrappedNativeTokens = [
          '0x4200000000000000000000000000000000000006', // WETH on Base
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH on Ethereum
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB on BSC
          '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC on Polygon
        ];
        
        const token0Lower = token0.toLowerCase();
        const token1Lower = token1.toLowerCase();
        
        let primaryToken, pairedToken, isPrimaryToken0;
        if (wrappedNativeTokens.includes(token0Lower)) {
          primaryToken = token1;
          pairedToken = token0;
          isPrimaryToken0 = false;
        } else if (wrappedNativeTokens.includes(token1Lower)) {
          primaryToken = token0;
          pairedToken = token1;
          isPrimaryToken0 = true;
        } else {
          // Neither is wrapped native, default to token0
          primaryToken = token0;
          pairedToken = token1;
          isPrimaryToken0 = true;
        }
        
        console.log(`UNCX LP Lock: token0=${token0}, token1=${token1}, primary=${primaryToken}, pool=${poolAddress}, unlock=${new Date(unlockTime * 1000).toISOString()}`);
        
        return { 
          tokenAddress: primaryToken, 
          token1: pairedToken,
          poolAddress,
          isPrimaryToken0,
          amount: null, // LP positions don't have a single "amount"
          unlockTime, 
          version: "UNCX V3",
          isLPLock: true,
          lpPosition
        };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "UNCX V3", isLPLock: true, lpPosition: null };
    }
    
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown", isLPLock: false, lpPosition: null };
  } catch (err) {
    console.error("Token extraction error:", err.message);
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown", isLPLock: false, lpPosition: null };
  }
}

async function getTokenInfo(tokenAddress, chainId) {
  const rpcUrls = RPC_URLS[chainId];
  if (!rpcUrls || rpcUrls.length === 0) {
    console.error(`No RPC URLs for chain ${chainId}`);
    return null;
  }
  
  if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
    console.error(`Invalid token address: ${tokenAddress}`);
    return null;
  }
  
  console.log(`Trying ${rpcUrls.length} RPCs in parallel for faster response...`);
  
  // Try ALL RPCs in parallel, use first successful response
  const attempts = rpcUrls.map(async (rpcUrl) => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const timeout = (ms) => new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      );
      
      const [symbol, decimals, totalSupply] = await Promise.all([
        Promise.race([contract.symbol(), timeout(3000)]),
        Promise.race([contract.decimals(), timeout(3000)]),
        Promise.race([contract.totalSupply(), timeout(3000)])
      ]);
      
      console.log(`✅ Token info from ${rpcUrl}: ${symbol}, decimals: ${decimals}`);
      
      return { 
        symbol, 
        decimals: Number(decimals), 
        totalSupply: totalSupply.toString(),
        rpcUsed: rpcUrl
      };
    } catch (err) {
      console.error(`❌ RPC ${rpcUrl} failed:`, err.message);
      throw err; // Reject this promise so Promise.any ignores it
    }
  });
  
  // Return first successful result
  try {
    const result = await Promise.any(attempts);
    console.log(`✅ Got token info from: ${result.rpcUsed}`);
    return result;
  } catch (err) {
    console.error('❌ All RPCs failed for token:', tokenAddress);
    return null;
  }
}

// Fetch BNB/ETH price for native token display
async function getNativeTokenPrice(chainId) {
  try {
    const nativeTokens = {
      1: 'ethereum',
      56: 'binancecoin', 
      137: 'matic-network',
      8453: 'ethereum'
    };
    
    const tokenId = nativeTokens[chainId];
    if (!tokenId) return null;
    
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`,
      { timeout: 3000 }
    );
    
    return response.data[tokenId]?.usd || null;
  } catch (err) {
    console.error("Failed to fetch native token price:", err.message);
    return null;
  }
}

// Extract COMPLETE LP position data from UNCX V3 lock
function extractLPPositionData(lockLog) {
  try {
    const data = lockLog.data || "0x";
    
    // Position tuple: liquidity at offset 1088, fee at 896, ticks at 960/1024, fees at 1280/1344
    if (data.length < 1408) {
      console.log(`Data too short for full LP extraction: ${data.length} chars`);
      return null;
    }
    
    // Extract liquidity (uint128 at offset 1088)
    const liquidityHex = data.slice(1090, 1154);
    const liquidity = BigInt(`0x${liquidityHex}`);
    
    // Extract fee tier (uint24 at offset 896)
    const feeHex = data.slice(898, 962);
    const feeTier = parseInt(feeHex, 16);
    
    // Extract tick range (int24 at offsets 960 and 1024)
    // int24 is only the last 3 bytes (6 hex chars) of the 32-byte word
    const tickLowerHex = data.slice(1020, 1026); // Last 6 chars of the word
    const tickUpperHex = data.slice(1084, 1090); // Last 6 chars of the word
    
    let tickLower = parseInt(tickLowerHex, 16);
    if (tickLower > 0x7FFFFF) tickLower -= 0x1000000; // Handle negative int24
    
    let tickUpper = parseInt(tickUpperHex, 16);
    if (tickUpper > 0x7FFFFF) tickUpper -= 0x1000000; // Handle negative int24
    
    // Extract uncollected fees (uint128 at offsets 1280 and 1344)
    const tokensOwed0Hex = data.slice(1282, 1346);
    const tokensOwed1Hex = data.slice(1346, 1410);
    const tokensOwed0 = BigInt(`0x${tokensOwed0Hex}`);
    const tokensOwed1 = BigInt(`0x${tokensOwed1Hex}`);
    
    console.log(`✅ LP Position: liquidity=${liquidity}, feeTier=${feeTier/10000}%, ticks=[${tickLower},${tickUpper}]`);
    
    return { liquidity, feeTier, tickLower, tickUpper, tokensOwed0, tokensOwed1 };
  } catch (err) {
    console.error("LP position extraction error:", err.message);
    return null;
  }
}

// Enrichment function - fetches price, MC, liquidity, holders from DexScreener/DexTools
async function enrichTokenData(tokenAddress, chainId, poolAddress = null) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    console.log(`Fetching enrichment data for ${tokenAddress} on ${chainName}`);
    
    // TRY 1: DexScreener (has price, MC, liquidity)
    try {
      console.log(`Trying DexScreener API...`);
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await axios.get(url, { timeout: 7000 });
      
      if (response.data?.pairs && response.data.pairs.length > 0) {
        const chainPairs = response.data.pairs.filter(p => p.chainId === chainName);
        
        if (chainPairs.length > 0) {
          const bestPair = chainPairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          )[0];
          
          console.log(`✅ DexScreener: price=$${bestPair.priceUsd}, liq=$${bestPair.liquidity?.usd}`);
          
          // Check if quote token is the native/wrapped native token
          const nativeTokenAddresses = {
            1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',    // WETH
            56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',   // WBNB
            137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',  // WMATIC
            8453: '0x4200000000000000000000000000000000000006'  // WETH on Base
          };
          
          const quoteTokenAddress = bestPair.quoteToken?.address?.toLowerCase();
          const nativeAddress = nativeTokenAddresses[chainId]?.toLowerCase();
          const isNativePair = quoteTokenAddress === nativeAddress;
          
          // If quote token is native token, use liquidity.quote, otherwise null
          const nativeTokenAmount = isNativePair && bestPair.liquidity?.quote 
            ? parseFloat(bestPair.liquidity.quote) 
            : null;
          
          if (nativeTokenAmount) {
            console.log(`✅ Native token in pair: ${nativeTokenAmount} ${bestPair.quoteToken?.symbol}`);
          }
          
          // Try to get security/holder data from GoPlus
          let securityData = {};
          try {
            const secUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
            const secResponse = await axios.get(secUrl, { timeout: 3000 });
            const secResult = secResponse.data?.result?.[tokenAddress.toLowerCase()];
            
            if (secResult) {
              securityData = {
                isOpenSource: secResult.is_open_source === "1",
                isHoneypot: secResult.is_honeypot === "1",
                canTakeBackOwnership: secResult.can_take_back_ownership === "1",
                ownerBalance: parseFloat(secResult.owner_percent || 0) * 100,
                holderCount: parseInt(secResult.holder_count || 0),
                topHolderPercent: parseFloat(secResult.holder_top10_percent || 0) * 100
              };
              console.log(`✅ GoPlus: holders=${securityData.holderCount}, verified=${securityData.isOpenSource}`);
            }
          } catch (secErr) {
            console.log(`GoPlus failed: ${secErr.message}`);
          }
          
          return {
            price: bestPair.priceUsd ? parseFloat(bestPair.priceUsd) : null,
            marketCap: bestPair.marketCap || null,
            liquidity: bestPair.liquidity?.usd || null,
            nativeTokenAmount: nativeTokenAmount,  // NEW: Amount of native token in pair
            pairName: `${bestPair.baseToken?.symbol || ''}/${bestPair.quoteToken?.symbol || ''}`,
            pairAddress: bestPair.pairAddress || null,
            pairCreatedAt: bestPair.pairCreatedAt || null,
            securityData,
            source: 'DexScreener'
          };
        }
      }
      
      console.log(`DexScreener: No pairs for ${chainName}`);
    } catch (err) {
      console.log(`DexScreener failed: ${err.message}`);
    }
    
    // TRY 2: DexTools (fallback - has price, MC, liquidity)
    try {
      console.log(`Trying DexTools API...`);
      const url = `https://www.dextools.io/shared/search/pair?query=${tokenAddress}`;
      const response = await axios.get(url, { 
        timeout: 7000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (response.data?.results && response.data.results.length > 0) {
        const chainPairs = response.data.results.filter(r => {
          const pairChain = r.id.chain?.toLowerCase();
          return pairChain === chainName || 
                 (chainName === 'bsc' && pairChain === 'bnb') ||
                 (chainName === 'polygon' && pairChain === 'matic');
        });
        
        if (chainPairs.length > 0) {
          const bestPair = chainPairs[0];
          console.log(`✅ DexTools: price=$${bestPair.price}`);
          
          return {
            price: bestPair.price || null,
            marketCap: bestPair.metrics?.marketCap || null,
            liquidity: bestPair.metrics?.liquidity || null,
            nativeTokenAmount: null,  // DexTools doesn't provide this easily
            pairName: bestPair.name || null,
            pairAddress: null,
            pairCreatedAt: null,
            securityData: {},
            source: 'DexTools'
          };
        }
      }
      
      console.log(`DexTools: No pairs for ${chainName}`);
    } catch (err) {
      console.log(`DexTools failed: ${err.message}`);
    }
    
    // Both failed
    console.log(`❌ Could not fetch data from DexScreener or DexTools`);
    return {
      price: null,
      marketCap: null,
      liquidity: null,
      nativeTokenAmount: null,
      pairName: null,
      pairAddress: null,
      pairCreatedAt: null,
      securityData: {},
      source: null
    };
    
  } catch (err) {
    console.error("Enrichment error:", err.message);
    return {
      price: null,
      marketCap: null,
      liquidity: null,
      nativeTokenAmount: null,
      pairName: null,
      pairAddress: null,
      pairCreatedAt: null,
      securityData: {},
      source: null
    };
  }
}

function formatDuration(unlockTime) {
  if (!unlockTime) return "Unknown";
  const now = Math.floor(Date.now() / 1000);
  const diff = unlockTime - now;
  
  if (diff < 0) return "Already unlocked";
  
  const days = Math.floor(diff / 86400);
  if (days < 1) return "< 1 day";
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}

function formatUnlockDate(unlockTime) {
  if (!unlockTime) return "Unknown";
  const date = new Date(unlockTime * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatContractAge(pairCreatedAt) {
  if (!pairCreatedAt) return null;
  
  const created = new Date(pairCreatedAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  // Show hours and minutes if less than 1 day
  if (diffDays < 1) {
    if (diffHours < 1) {
      return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} old`;
    }
    const remainingMinutes = diffMinutes - (diffHours * 60);
    return `${diffHours}h ${remainingMinutes}m old`;
  }
  
  if (diffDays === 1) return "1 day old";
  if (diffDays < 7) return `${diffDays} days old`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks old`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months old`;
  return `${Math.floor(diffDays / 365)} years old`;
}

function getBuyLink(tokenAddress, chainId) {
  const links = {
    1: `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`,
    56: `https://pancakeswap.finance/swap?outputCurrency=${tokenAddress}`,
    137: `https://quickswap.exchange/#/swap?outputCurrency=${tokenAddress}`,
    8453: `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}&chain=base`
  };
  return links[chainId] || null;
}

function getDexInfo(chainId) {
  const dexInfo = {
    1: { name: "Uniswap", url: "https://app.uniswap.org" },
    56: { name: "PancakeSwap", url: "https://pancakeswap.finance" },
    137: { name: "QuickSwap", url: "https://quickswap.exchange" },
    8453: { name: "Uniswap", url: "https://app.uniswap.org" }
  };
  return dexInfo[chainId] || null;
}

async function editTelegramMessage(messageId, text) {
  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`,
    {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }
  );
}

// In-memory cache to prevent duplicate enrichments
const enrichmentCache = new Map();
const CACHE_TTL = 600000; // 10 minutes

module.exports = async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log("🔄 Enrichment endpoint called");
    console.log("Method:", req.method);
    console.log("Body keys:", Object.keys(req.body || {}));
    
    const { messageId, txHash, chainId, lockLog, eventName, source, explorerLink, chain } = req.body;
    
    if (!messageId || !chainId || !lockLog) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Check for duplicate enrichment request
    if (txHash && enrichmentCache.has(txHash)) {
      const cachedTime = enrichmentCache.get(txHash);
      const timeSince = Date.now() - cachedTime;
      
      if (timeSince < CACHE_TTL) {
        console.log(`⚠️ Duplicate enrichment request for ${txHash} (${Math.floor(timeSince / 1000)}s ago)`);
        return res.status(200).json({ status: "skipped", reason: "duplicate" });
      }
    }
    
    // Mark this txHash as being processed
    if (txHash) {
      enrichmentCache.set(txHash, Date.now());
      
      // Clean up old entries periodically
      if (enrichmentCache.size > 100) {
        const now = Date.now();
        for (const [key, timestamp] of enrichmentCache.entries()) {
          if (now - timestamp > CACHE_TTL) {
            enrichmentCache.delete(key);
          }
        }
      }
    }
    
    // Extract token data
    const tokenData = extractTokenData(lockLog, eventName, source);
    console.log("Token extraction result:", JSON.stringify(tokenData, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));
    
    if (!tokenData.tokenAddress) {
      console.log("⚠️ Could not extract token address");
      await editTelegramMessage(messageId, `⚠️ Could not extract token address\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "no_token_address" });
    }
    
    // Get token info
    const tokenInfo = await getTokenInfo(tokenData.tokenAddress, chainId);
    
    if (!tokenInfo) {
      console.log("⚠️ Could not fetch token info");
      await editTelegramMessage(messageId, `⚠️ Could not fetch token info\n\nToken: \`${tokenData.tokenAddress}\`\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "rpc_failed" });
    }
    
    console.log(`Token info fetched: ${tokenInfo.symbol}`);
    
    // Calculate amounts
    const amount = tokenData.amount ? Number(tokenData.amount) / Math.pow(10, tokenInfo.decimals) : null;
    const duration = formatDuration(tokenData.unlockTime);
    const unlockDate = formatUnlockDate(tokenData.unlockTime);
    
    // Enrich with price/security
    const enriched = await enrichTokenData(tokenData.tokenAddress, chainId);
    
    console.log(`Enrichment complete: price=${enriched.price}, liquidity=${enriched.liquidity}`);
    
    // Get native token price for display (optional - don't fail if it errors)
    let nativePrice = null;
    try {
      nativePrice = await getNativeTokenPrice(chainId);
      console.log(`Native token price: ${nativePrice}`);
    } catch (err) {
      console.error("Failed to get native token price:", err.message);
    }
    
    const nativeSymbols = { 1: 'ETH', 56: 'BNB', 137: 'MATIC', 8453: 'ETH' };
    const nativeSymbol = nativeSymbols[chainId] || 'ETH';
    
    // Calculate percentages and values
    let lockedPercent = null;
    let usdValue = null;
    let pairedTokenAmount = null;
    
    if (tokenData.isLPLock && tokenData.lpPosition) {
      // For LP locks: We can't easily calculate exact token amounts without current tick
      // But we CAN show % of the primary token's supply if we had its amount
      // For now, show the LP token amount and note that % calculation requires pool state
      
      // Note: To properly calculate % and USD value, we'd need:
      // 1. Current tick from the pool contract
      // 2. Calculate token amounts from liquidity + ticks
      // This requires additional RPC calls which we'll skip for now
      
      lockedPercent = null; // TODO: Calculate when we have token amounts
      usdValue = null; // TODO: Calculate when we have token amounts  
      pairedTokenAmount = null; // TODO: Calculate from LP position
    } else if (amount) {
      // For regular token locks: calculate from amount
      lockedPercent = tokenInfo.totalSupply 
        ? ((amount / (Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals))) * 100).toFixed(2)
        : null;
      
      usdValue = enriched.price 
        ? (amount * enriched.price).toFixed(2)
        : null;
    }
    
    // Build message
    const parts = ["🔒 **New lock detected**", ""];
    
    parts.push("💎 **Token info**");
    parts.push(`Token: $${tokenInfo.symbol}`);
    
    // Show pair name if available
    if (enriched.pairName) {
      parts.push(`Pair: ${enriched.pairName}`);
    } else if (tokenData.isLPLock && tokenData.token1) {
      parts.push(`Pair: ${tokenInfo.symbol}/[paired token]`);
    }
    
    parts.push(`Address: \`${tokenData.tokenAddress.slice(0, 6)}...${tokenData.tokenAddress.slice(-4)}\``);
    
    if (enriched.price) {
      const priceStr = enriched.price < 0.01 
        ? enriched.price.toExponential(6)
        : enriched.price.toFixed(6);
      parts.push(`Price: $${priceStr}`);
    }
    
    if (enriched.marketCap) {
      const mcStr = enriched.marketCap >= 1000000 
        ? `$${(enriched.marketCap / 1000000).toFixed(1)}M`
        : enriched.marketCap >= 1000
        ? `$${(enriched.marketCap / 1000).toFixed(1)}K`
        : `$${enriched.marketCap.toFixed(0)}`;
      parts.push(`MC: ${mcStr}`);
    }
    
    if (enriched.liquidity) {
      const liqStr = enriched.liquidity >= 1000000
        ? `$${(enriched.liquidity / 1000000).toFixed(1)}M`
        : enriched.liquidity >= 1000
        ? `$${(enriched.liquidity / 1000).toFixed(1)}K`
        : `$${enriched.liquidity.toFixed(0)}`;
      parts.push(`Liquidity: ${liqStr}`);
    }
    
    // Show pool age (good proxy for token age)
    const pairAge = formatContractAge(enriched.pairCreatedAt);
    if (pairAge) {
      parts.push(`Pool Age: ${pairAge}`);
    }
    
    if (enriched.securityData?.holderCount) {
      parts.push(`Holders: ${enriched.securityData.holderCount.toLocaleString()}`);
    }
    
    // Always show owner balance if available
    if (enriched.securityData?.ownerBalance !== undefined && enriched.securityData?.ownerBalance !== null) {
      parts.push(`Owner: ${enriched.securityData.ownerBalance.toFixed(1)}%`);
    }
    
    parts.push("");
    parts.push("🔐 **Lock details**");
    
    if (amount) {
      const amountStr = amount >= 1000000 
        ? `${(amount / 1000000).toFixed(1)}M`
        : amount >= 1000
        ? `${(amount / 1000).toFixed(1)}K`
        : amount.toFixed(0);
      parts.push(`Amount: ${amountStr} tokens`);
    } else if (tokenData.isLPLock && tokenData.lpPosition) {
      const liquidityFormatted = (Number(tokenData.lpPosition.liquidity) / 1e18).toFixed(2);
      parts.push(`Amount: ${liquidityFormatted} LP tokens`);
    }
    
    if (usdValue) {
      parts.push(`Value: $${Number(usdValue).toLocaleString()}`);
    }
    
    // Show native token value if available
    if (enriched.nativeTokenAmount && enriched.nativeTokenAmount > 0) {
      const nativeStr = enriched.nativeTokenAmount >= 1 
        ? enriched.nativeTokenAmount.toFixed(2)
        : enriched.nativeTokenAmount.toFixed(4);
      
      // Combine native amount and USD value on one line
      if (nativePrice) {
        const nativeUsdValue = (enriched.nativeTokenAmount * nativePrice).toFixed(2);
        parts.push(`Native: ${nativeStr} ${nativeSymbol} ($${Number(nativeUsdValue).toLocaleString()})`);
      } else {
        parts.push(`Native: ${nativeStr} ${nativeSymbol}`);
      }
    }
    
    if (lockedPercent) {
      parts.push(`Locked: ${lockedPercent}% of supply`);
    }
    
    parts.push(`Duration: ${duration}`);
    parts.push(`Source: ${source}`);
    parts.push(`Chain: ${chain}`);
    
    // Quick check section
    if (enriched.securityData && Object.keys(enriched.securityData).length > 0) {
      parts.push("");
      parts.push("⚡ **Quick check**");
      
      if (enriched.securityData.isOpenSource === true) {
        parts.push("✅ Verified contract");
      } else if (enriched.securityData.isOpenSource === false) {
        parts.push("⚠️ Not verified");
      }
      
      if (enriched.securityData.isHoneypot === false) {
        parts.push("✅ Not honeypot");
      } else if (enriched.securityData.isHoneypot === true) {
        parts.push("🔴 Honeypot detected!");
      }
      
      if (enriched.securityData.ownerBalance > 50) {
        parts.push(`🔴 Owner holds ${enriched.securityData.ownerBalance.toFixed(1)}%`);
      } else if (enriched.securityData.ownerBalance > 20) {
        parts.push(`⚠️ Owner holds ${enriched.securityData.ownerBalance.toFixed(1)}%`);
      }
    }
    
    parts.push("");
    parts.push("🔗 **Links**");
    
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    parts.push(`[DexScreener](https://dexscreener.com/${chainName}/${tokenData.tokenAddress})`);
    parts.push(`[DexTools](https://www.dextools.io/app/en/${chainName}/pair-explorer/${tokenData.tokenAddress})`);
    parts.push(`[TokenSniffer](https://tokensniffer.com/token/${chainName}/${tokenData.tokenAddress})`);
    
    parts.push("");
    
    const buyLink = getBuyLink(tokenData.tokenAddress, chainId);
    const dexInfo = getDexInfo(chainId);
    if (buyLink && dexInfo) {
      parts.push(`[🛒 Buy on ${dexInfo.name}](${buyLink})`);
    } else if (buyLink) {
      parts.push(`[🛒 Buy Now](${buyLink})`);
    }
    
    parts.push("");
    
    parts.push(`[View Transaction](${explorerLink})`);
    
    const enrichedMessage = parts.join("\n");
    
    await editTelegramMessage(messageId, enrichedMessage);
    
    console.log("✅ Enrichment complete and message updated");
    
    return res.status(200).json({ status: "success" });
    
  } catch (err) {
    console.error("❌ Enrichment error:", err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
};
