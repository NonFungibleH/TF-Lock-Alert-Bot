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
        return { tokenAddress, amount, unlockTime, version: "V3" };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    if (eventName === "onDeposit") {
      if (data.length >= 322) {
        const tokenAddress = `0x${data.slice(26, 66)}`;
        const amountHex = data.slice(130, 194);
        const unlockHex = data.slice(258, 322);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V2" };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V2" };
    }
    
    if (source === "Team Finance" && eventName === "DepositNFT") {
      const tokenAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      if (data.length >= 258) {
        const amountHex = data.slice(130, 194);
        const unlockHex = data.slice(194, 258);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V3" };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    if (eventName === "DepositNFT" || eventName === "onLock") {
      const tokenAddress = topicsArray[2] ? `0x${topicsArray[2].slice(26)}` : null;
      if (data.length >= 130) {
        const amountHex = data.slice(2, 66);
        const unlockHex = data.slice(66, 130);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        return { tokenAddress, amount, unlockTime, version: "V3" };
      }
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown" };
  } catch (err) {
    console.error("Token extraction error:", err.message);
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown" };
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

// Enrichment function - fetches price, liquidity, security data
async function enrichTokenData(tokenAddress, chainId) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    console.log(`Starting enrichment for ${tokenAddress} on ${chainName}`);
    
    // Return empty enrichment data for now
    // TODO: Add actual API calls to fetch price, liquidity, and security data
    return {
      price: null,
      marketCap: null,
      liquidity: null,
      pairCreatedAt: null,
      securityFlags: {}
    };
    
  } catch (err) {
    console.error("Enrichment error:", err);
    return {
      price: null,
      marketCap: null,
      liquidity: null,
      pairCreatedAt: null,
      securityFlags: {}
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
  
  if (diffDays < 1) return "< 1 day old";
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
    
    // Calculate percentages
    const lockedPercent = amount && tokenInfo.totalSupply 
      ? ((amount / (Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals))) * 100).toFixed(2)
      : null;
    
    const usdValue = amount && enriched.price 
      ? (amount * enriched.price).toFixed(2)
      : null;
    
    // Build message
    const parts = ["🔒 **New lock detected**", ""];
    
    parts.push("💎 **TOKEN INFO**");
    parts.push(`Token: $${tokenInfo.symbol}`);
    parts.push(`Address: \`${tokenData.tokenAddress.slice(0, 8)}...${tokenData.tokenAddress.slice(-6)}\``);
    
    if (enriched.price) {
      const priceStr = enriched.price < 0.01 
        ? enriched.price.toExponential(2) 
        : enriched.price.toFixed(6);
      parts.push(`Price: $${priceStr}`);
    }
    
    if (enriched.marketCap) {
      const mcStr = enriched.marketCap >= 1000000 
        ? `$${(enriched.marketCap / 1000000).toFixed(2)}M`
        : `$${(enriched.marketCap / 1000).toFixed(1)}K`;
      parts.push(`MC: ${mcStr}`);
    }
    
    if (enriched.liquidity) {
      const liqStr = enriched.liquidity >= 1000000
        ? `${(enriched.liquidity / 1000000).toFixed(2)}M`
        : `${(enriched.liquidity / 1000).toFixed(1)}K`;
      parts.push(`Liquidity: ${liqStr}`);
    }
    
    const contractAge = formatContractAge(enriched.pairCreatedAt);
    if (contractAge) {
      parts.push(`Age: ${contractAge}`);
    }
    
    // Add holder count in TOKEN INFO section
    if (enriched.securityFlags.holderCount) {
      parts.push(`Holders: ${enriched.securityFlags.holderCount.toLocaleString()}`);
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
      parts.push(`Value: ${Number(usdValue).toLocaleString()}`);
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
    
    parts.push(`[DexScreener](https://dexscreener.com/${chainName}/${tokenData.tokenAddress})`);
    parts.push(`[DexTools](https://www.dextools.io/app/en/${chainName}/pair-explorer/${tokenData.tokenAddress})`);
    parts.push(`[TokenSniffer](https://tokensniffer.com/token/${chainName}/${tokenData.tokenAddress})`);
    
    const buyLink = getBuyLink(tokenData.tokenAddress, chainId);
    if (buyLink) {
      parts.push(`[🛒 Buy Now](${buyLink})`);
    }
    
    parts.push("");
    
    // QUICK CHECK section (security flags) - moved here after LINKS
    const hasSecurityInfo = enriched.securityFlags && Object.keys(enriched.securityFlags).length > 0;
    
    if (hasSecurityInfo) {
      parts.push("⚡ **QUICK CHECK**");
      
      if (enriched.securityFlags.isOpenSource === true) {
        parts.push("✅ Verified contract");
      } else if (enriched.securityFlags.isOpenSource === false) {
        parts.push("⚠️ Not verified");
      }
      
      if (enriched.securityFlags.isHoneypot === false) {
        parts.push("✅ Not honeypot");
      } else if (enriched.securityFlags.isHoneypot === true) {
        parts.push("🔴 Honeypot detected!");
      }
      
      if (enriched.securityFlags.canTakeBackOwnership === true) {
        parts.push("⚠️ Can take back ownership");
      }
      
      if (enriched.securityFlags.ownerBalance > 50) {
        parts.push(`🔴 Owner holds ${enriched.securityFlags.ownerBalance.toFixed(1)}%`);
      } else if (enriched.securityFlags.ownerBalance > 20) {
        parts.push(`⚠️ Owner holds ${enriched.securityFlags.ownerBalance.toFixed(1)}%`);
      }
      
      if (enriched.securityFlags.topHolderPercent > 70) {
        parts.push(`🔴 Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
      } else if (enriched.securityFlags.topHolderPercent > 50) {
        parts.push(`⚠️ Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
      }
      
      if (enriched.securityFlags.lpHolderCount > 0) {
        parts.push(`💧 LP: ${enriched.securityFlags.lpHolderCount} holders`);
      }
      
      parts.push("");
    }
    
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
