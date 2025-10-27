const axios = require("axios");
const { ethers } = require("ethers");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// RPC endpoints
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

// Extract COMPLETE LP position data from UNCX V3 lock
function extractLPPositionData(lockLog) {
  try {
    const data = lockLog.data || "0x";
    
    /* Position tuple structure (starts at offset 640 in hex, or byte 320):
     * Each field is 32 bytes (64 hex chars) in the ABI encoding
     * 
     * Offset 640 (0x280): nonce (uint96) - padded to 32 bytes
     * Offset 704 (0x2c0): operator (address) - padded to 32 bytes
     * Offset 768 (0x300): token0 (address) - padded to 32 bytes  ✓ Already extracted
     * Offset 832 (0x340): token1 (address) - padded to 32 bytes  ✓ Already extracted
     * Offset 896 (0x380): fee (uint24) - padded to 32 bytes
     * Offset 960 (0x3c0): tickLower (int24) - padded to 32 bytes
     * Offset 1024 (0x400): tickUpper (int24) - padded to 32 bytes
     * Offset 1088 (0x440): liquidity (uint128) - padded to 32 bytes  ← CRITICAL
     * Offset 1152 (0x480): feeGrowthInside0LastX128 (uint256)
     * Offset 1216 (0x4c0): feeGrowthInside1LastX128 (uint256)
     * Offset 1280 (0x500): tokensOwed0 (uint128) - padded to 32 bytes
     * Offset 1344 (0x540): tokensOwed1 (uint128) - padded to 32 bytes
     */
    
    if (data.length < 1408) { // Need at least up to tokensOwed1
      console.log(`Data too short for full LP extraction: ${data.length} chars`);
      return null;
    }
    
    // Extract liquidity (uint128 at offset 1088)
    const liquidityHex = data.slice(1090, 1154); // 1090 = 2 + 1088
    const liquidity = BigInt(`0x${liquidityHex}`);
    
    // Extract fee tier (uint24 at offset 896)
    const feeHex = data.slice(898, 962);
    const feeTier = parseInt(feeHex, 16);
    
    // Extract tick range (int24 at offsets 960 and 1024)
    const tickLowerHex = data.slice(962, 1026);
    const tickUpperHex = data.slice(1026, 1090);
    
    // Convert to signed integers (int24)
    let tickLower = parseInt(tickLowerHex, 16);
    if (tickLower > 0x7FFFFF) tickLower -= 0x1000000; // Handle negative
    
    let tickUpper = parseInt(tickUpperHex, 16);
    if (tickUpper > 0x7FFFFF) tickUpper -= 0x1000000; // Handle negative
    
    // Extract uncollected fees (uint128 at offsets 1280 and 1344)
    const tokensOwed0Hex = data.slice(1282, 1346);
    const tokensOwed1Hex = data.slice(1346, 1410);
    const tokensOwed0 = BigInt(`0x${tokensOwed0Hex}`);
    const tokensOwed1 = BigInt(`0x${tokensOwed1Hex}`);
    
    console.log(`✅ Extracted LP Position Data:`);
    console.log(`  - Liquidity: ${liquidity.toString()}`);
    console.log(`  - Fee Tier: ${feeTier / 10000}%`);
    console.log(`  - Tick Range: [${tickLower}, ${tickUpper}]`);
    console.log(`  - Uncollected Fees: ${tokensOwed0.toString()} / ${tokensOwed1.toString()}`);
    
    return {
      liquidity,
      feeTier,
      tickLower,
      tickUpper,
      tokensOwed0,
      tokensOwed1
    };
  } catch (err) {
    console.error("LP position extraction error:", err.message);
    return null;
  }
}

// Extract token data from various lock events
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
    
    // Team Finance V3 Deposit (regular token locks)
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
    
    // UNCX V2 onDeposit (older format)
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
    
    // Team Finance V3 DepositNFT (NFT position locks)
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
    
    // Generic DepositNFT
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
    
    // UNCX V3 onLock (LP position locks - MOST COMMON)
    if (eventName === "onLock" && source === "UNCX") {
      if (data.length >= 896) {
        // Extract unlock time (offset 384)
        const unlockHex = data.slice(386, 450);
        const unlockTime = parseInt(unlockHex, 16);
        
        // Extract token0 and token1 (offsets 768, 832)
        const token0 = `0x${data.slice(794, 834)}`;
        const token1 = `0x${data.slice(858, 898)}`;
        
        // Extract FULL LP position data
        const lpPosition = extractLPPositionData(lockLog);
        
        console.log(`UNCX LP Lock: token0=${token0}, token1=${token1}, unlock=${new Date(unlockTime * 1000).toISOString()}`);
        
        return { 
          tokenAddress: token0, 
          token1: token1,
          amount: null,
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
  
  console.log(`Trying ${rpcUrls.length} RPCs in parallel...`);
  
  const attempts = rpcUrls.map(async (rpcUrl) => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      const timeout = (ms) => new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      );
      
      const [symbol, decimals, totalSupply] = await Promise.all([
        Promise.race([contract.symbol(), timeout(5000)]),
        Promise.race([contract.decimals(), timeout(5000)]),
        Promise.race([contract.totalSupply(), timeout(5000)])
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
      throw err;
    }
  });
  
  try {
    const result = await Promise.any(attempts);
    console.log(`✅ Got token info from: ${result.rpcUsed}`);
    return result;
  } catch (err) {
    console.error('❌ All RPCs failed for token:', tokenAddress);
    return null;
  }
}

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
      { timeout: 5000 }
    );
    
    return response.data[tokenId]?.usd || null;
  } catch (err) {
    console.error("Error fetching native token price:", err.message);
    return null;
  }
}

// ONLY fetch price from APIs - everything else comes from lock data
async function getTokenPrice(tokenAddress, chainId) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    console.log(`Fetching price for ${tokenAddress} on ${chainName}`);
    
    // TRY 1: DexScreener (faster, more reliable)
    try {
      console.log(`Trying DexScreener API...`);
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data?.pairs && response.data.pairs.length > 0) {
        const chainPairs = response.data.pairs.filter(p => p.chainId === chainName);
        
        if (chainPairs.length > 0) {
          const bestPair = chainPairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          )[0];
          
          if (bestPair.priceUsd) {
            console.log(`✅ DexScreener price: $${bestPair.priceUsd}`);
            return {
              price: parseFloat(bestPair.priceUsd),
              source: 'DexScreener'
            };
          }
        }
      }
      
      console.log(`DexScreener: No price data for ${chainName}`);
    } catch (err) {
      console.log(`DexScreener failed: ${err.message}`);
    }
    
    // TRY 2: DexTools (fallback)
    try {
      console.log(`Trying DexTools API...`);
      const url = `https://www.dextools.io/shared/search/pair?query=${tokenAddress}`;
      const response = await axios.get(url, { 
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      if (response.data?.results && response.data.results.length > 0) {
        const chainPairs = response.data.results.filter(r => {
          const pairChain = r.id.chain?.toLowerCase();
          return pairChain === chainName || 
                 (chainName === 'bsc' && pairChain === 'bnb') ||
                 (chainName === 'polygon' && pairChain === 'matic');
        });
        
        if (chainPairs.length > 0 && chainPairs[0].price) {
          console.log(`✅ DexTools price: $${chainPairs[0].price}`);
          return {
            price: chainPairs[0].price,
            source: 'DexTools'
          };
        }
      }
      
      console.log(`DexTools: No price data for ${chainName}`);
    } catch (err) {
      console.log(`DexTools failed: ${err.message}`);
    }
    
    // Both failed
    console.log(`❌ Could not fetch price from any source`);
    return { price: null, source: null };
    
  } catch (err) {
    console.error("Price fetch error:", err.message);
    return { price: null, source: null };
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
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${month} ${year}`;
}

function getBuyLink(tokenAddress, chainId) {
  const links = {
    1: `https://app.uniswap.org/swap?outputCurrency=${tokenAddress}&chain=ethereum`,
    56: `https://pancakeswap.finance/swap?outputCurrency=${tokenAddress}&chain=bsc`,
    137: `https://app.uniswap.org/swap?outputCurrency=${tokenAddress}&chain=polygon`,
    8453: `https://app.uniswap.org/swap?outputCurrency=${tokenAddress}&chain=base`
  };
  return links[chainId] || null;
}

async function editTelegramMessage(messageId, text) {
  try {
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
  } catch (err) {
    console.error("Failed to edit Telegram message:", err.message);
    throw err;
  }
}

// Cache to prevent duplicate enrichment requests
const enrichmentCache = new Map();
const CACHE_TTL = 60000;

module.exports = async (req, res) => {
  try {
    console.log("🔄 Enrichment endpoint called");
    console.log("Method:", req.method);
    
    if (req.method === "GET") {
      return res.status(200).json({ status: "ready" });
    }
    
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    
    const { messageId, txHash, chainId, lockLog, eventName, source, explorerLink, chain } = req.body;
    
    if (!messageId || !chainId || !lockLog) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Check for duplicate
    if (txHash && enrichmentCache.has(txHash)) {
      const timeSince = Date.now() - enrichmentCache.get(txHash);
      if (timeSince < CACHE_TTL) {
        console.log(`⚠️ Duplicate request for ${txHash}`);
        return res.status(200).json({ status: "skipped", reason: "duplicate" });
      }
    }
    
    if (txHash) {
      enrichmentCache.set(txHash, Date.now());
      
      if (enrichmentCache.size > 100) {
        const now = Date.now();
        for (const [key, timestamp] of enrichmentCache.entries()) {
          if (now - timestamp > CACHE_TTL) enrichmentCache.delete(key);
        }
      }
    }
    
    // Extract ALL data from lock event
    const tokenData = extractTokenData(lockLog, eventName, source);
    console.log("Token extraction result:", JSON.stringify(tokenData, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));
    
    if (!tokenData.tokenAddress) {
      console.log("⚠️ Could not extract token address");
      await editTelegramMessage(messageId, `⚠️ Could not extract token address\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "no_token_address" });
    }
    
    // Get token info from blockchain
    const tokenInfo = await getTokenInfo(tokenData.tokenAddress, chainId);
    
    if (!tokenInfo) {
      console.log("⚠️ Could not fetch token info");
      await editTelegramMessage(messageId, `⚠️ Could not fetch token info\n\nToken: \`${tokenData.tokenAddress}\`\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "rpc_failed" });
    }
    
    console.log(`Token info: ${tokenInfo.symbol}`);
    
    // Calculate amounts
    const amount = tokenData.amount ? Number(tokenData.amount) / Math.pow(10, tokenInfo.decimals) : null;
    const duration = formatDuration(tokenData.unlockTime);
    const unlockDate = formatUnlockDate(tokenData.unlockTime);
    
    // ONLY fetch price from APIs (everything else is from lock data)
    const priceData = await getTokenPrice(tokenData.tokenAddress, chainId);
    console.log(`Price: ${priceData.price}, Source: ${priceData.source}`);
    
    // Calculate USD value if we have price and amount
    const usdValue = amount && priceData.price 
      ? (amount * priceData.price).toFixed(2)
      : null;
    
    // Calculate locked percentage
    const lockedPercent = amount && tokenInfo.totalSupply 
      ? ((amount / (Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals))) * 100).toFixed(2)
      : null;
    
    // Get native token price for reference
    let nativePrice = null;
    try {
      nativePrice = await getNativeTokenPrice(chainId);
    } catch (err) {
      console.error("Failed to get native token price:", err.message);
    }
    
    // Build message
    const parts = ["🔒 **New lock detected**", ""];
    
    parts.push("💎 **TOKEN INFO**");
    parts.push(`Token: $${tokenInfo.symbol}`);
    parts.push(`Address: \`${tokenData.tokenAddress.slice(0, 8)}...${tokenData.tokenAddress.slice(-6)}\``);
    
    if (priceData.price) {
      const priceStr = priceData.price < 0.01 
        ? priceData.price.toExponential(2) 
        : priceData.price.toFixed(6);
      parts.push(`Price: $${priceStr}`);
    }
    
    // For LP locks, show the LP position data we extracted
    if (tokenData.isLPLock && tokenData.lpPosition) {
      parts.push("");
      parts.push("💧 **LP POSITION DATA**");
      
      // Show liquidity amount
      const liquidityFormatted = (Number(tokenData.lpPosition.liquidity) / 1e18).toFixed(4);
      parts.push(`Liquidity: ${liquidityFormatted} LP tokens`);
      
      // Show fee tier
      const feePercent = tokenData.lpPosition.feeTier / 10000;
      parts.push(`Fee Tier: ${feePercent}%`);
      
      // Show tick range
      parts.push(`Price Range: [${tokenData.lpPosition.tickLower}, ${tokenData.lpPosition.tickUpper}]`);
      
      // Show uncollected fees if any
      const fees0 = Number(tokenData.lpPosition.tokensOwed0);
      const fees1 = Number(tokenData.lpPosition.tokensOwed1);
      if (fees0 > 0 || fees1 > 0) {
        parts.push(`Uncollected Fees: ${(fees0 / 1e18).toFixed(6)} / ${(fees1 / 1e18).toFixed(6)}`);
      }
      
      // Show token1 info
      if (tokenData.token1) {
        parts.push(`Paired with: \`${tokenData.token1.slice(0, 8)}...${tokenData.token1.slice(-6)}\``);
      }
    }
    
    // Show "no price data" message only if we couldn't get price
    if (!priceData.price) {
      parts.push("");
      parts.push("⚠️ _Price unavailable from DexScreener or DexTools_");
    }
    
    parts.push("");
    parts.push("🔐 **LOCK DETAILS**");
    
    if (amount) {
      const amountStr = amount >= 1000000 
        ? `${(amount / 1000000).toFixed(2)}M`
        : amount >= 1000
        ? `${(amount / 1000).toFixed(1)}K`
        : amount.toFixed(2);
      parts.push(`Amount: ${amountStr} tokens`);
    }
    
    if (usdValue) {
      parts.push(`Value: $${Number(usdValue).toLocaleString()}`);
    }
    
    if (lockedPercent) {
      parts.push(`Locked: ${lockedPercent}% of supply`);
    }
    
    parts.push(`Duration: ${duration} (until ${unlockDate})`);
    parts.push(`Source: ${source}`);
    parts.push(`Chain: ${chain}`);
    
    parts.push("");
    parts.push("🔗 **LINKS**");
    
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    parts.push(`[DexScreener](https://dexscreener.com/${chainName}/${tokenData.tokenAddress}) | [DexTools](https://www.dextools.io/app/en/${chainName}/pair-explorer/${tokenData.tokenAddress}) | [TokenSniffer](https://tokensniffer.com/token/${chainName}/${tokenData.tokenAddress})`);
    
    const buyLink = getBuyLink(tokenData.tokenAddress, chainId);
    if (buyLink) {
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
