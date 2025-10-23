const axios = require("axios");
const { ethers } = require("ethers");
const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// RPC endpoints for blockchain calls - prioritize fastest
const RPC_URLS = {
  1: [
    "https://rpc.ankr.com/eth",
    process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
    "https://ethereum.publicnode.com"
  ],
  56: [
    "https://rpc.ankr.com/bsc", // Ankr is usually fastest
    "https://bsc-dataseed1.ninicoin.io",
    process.env.BSC_RPC || "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io"
  ],
  137: [
    "https://rpc.ankr.com/polygon",
    process.env.POLYGON_RPC || "https://polygon-rpc.com"
  ],
  8453: [
    "https://base.llamarpc.com",
    process.env.BASE_RPC || "https://mainnet.base.org"
  ]
};

// ERC20 ABI for token info
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)"
];

// Extract token data from lock logs
function extractTokenData(lockLog, eventName, source) {
  try {
    // Moralis puts topics in separate fields, not an array
    const topics = lockLog.topics || [];
    
    // If topics array is empty, build it from topic0, topic1, topic2, topic3
    const topicsArray = topics.length > 0 ? topics : [
      lockLog.topic0,
      lockLog.topic1, 
      lockLog.topic2,
      lockLog.topic3
    ].filter(t => t !== null && t !== undefined);
    
    const data = lockLog.data || "0x";
    
    console.log(`Extracting token - Event: ${eventName}, Source: ${source}`);
    console.log(`Topics length: ${topicsArray.length}, Data length: ${data.length}`);
    console.log(`Topics:`, topicsArray);
    console.log(`Data:`, data);
    
    // Team Finance V3 uses "Deposit" event (different from V2!)
    // V3 structure: topics[1] = token, topics[2] = withdrawer, data = id + amount + unlockTime
    if (source === "Team Finance" && eventName === "Deposit") {
      const tokenAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      console.log(`TF V3 Deposit - Extracted token: ${tokenAddress}`);
      
      if (data.length >= 194) {
        // Skip first 64 chars (id), then get amount and unlock
        const amountHex = data.slice(66, 130);
        const unlockHex = data.slice(130, 194);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`TF V3 Deposit - Amount: ${amount}, Unlock: ${unlockTime}`);
        return { tokenAddress, amount, unlockTime, version: "V3" };
      }
      
      console.log(`TF V3 Deposit - Data too short: ${data.length}`);
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    // UNCX V2 onDeposit - NO indexed topics, all data in data field!
    if (eventName === "onDeposit") {
      // Data structure: lpToken (32 bytes) + user (32 bytes) + amount (32 bytes) + lockDate (32 bytes) + unlockDate (32 bytes)
      if (data.length >= 322) { // 2 (0x) + 320 (5 * 64 hex chars)
        // Each field is 64 hex chars (32 bytes). Addresses are right-padded with zeros
        const tokenAddress = `0x${data.slice(26, 66)}`; // First 32 bytes, last 20 bytes = address
        const amountHex = data.slice(130, 194); // Third 32 bytes (skip 2 + 64 + 64)
        const unlockHex = data.slice(258, 322); // Fifth 32 bytes (skip 2 + 64*4)
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`UNCX V2 onDeposit - Token: ${tokenAddress}, Amount: ${amount}, Unlock: ${unlockTime}`);
        return { tokenAddress, amount, unlockTime, version: "V2" };
      }
      
      console.log(`UNCX V2 onDeposit - Data too short: ${data.length}`);
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V2" };
    }
    
    // Team Finance V3 DepositNFT - token is indexed in topics[1]
    if (source === "Team Finance" && eventName === "DepositNFT") {
      const tokenAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      console.log(`TF V3 DepositNFT - Extracted token: ${tokenAddress}`);
      
      if (data.length >= 258) { // id (64) + tokenId (64) + amount (64) + unlockTime (64) = 256 + 2
        const tokenIdHex = data.slice(66, 130); // Second 32 bytes
        const amountHex = data.slice(130, 194); // Third 32 bytes  
        const unlockHex = data.slice(194, 258); // Fourth 32 bytes
        const tokenId = parseInt(tokenIdHex, 16);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`TF V3 DepositNFT - TokenId: ${tokenId}, Amount: ${amount}, Unlock: ${unlockTime}`);
        return { tokenAddress, amount, unlockTime, version: "V3", tokenId };
      }
      
      console.log(`TF V3 DepositNFT - Data too short: ${data.length}`);
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    // Generic DepositNFT/onLock fallback (for other sources)
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
    
    // UNCX V3 onLock - NO indexed topics, complex data structure
    // The 10th parameter (index 9) is poolAddress (at byte 640)
    // Data fields: lock_id, nftPositionManager, nft_id, owner, additionalCollector, collectAddress, unlockDate, countryCode, collectFee, poolAddress, position(tuple)
    if ((source === "UNCX" && eventName === "onLock") || eventName === "DepositNFT") {
      // For UNCX V3 onLock, poolAddress is at position 9 (10th field) = offset 640 (9 * 64 + 2 + 64)
      if (data.length >= 706) { // Need at least 10 fields
        const poolAddress = `0x${data.slice(642, 706).slice(-40)}`; // Get last 40 hex chars (20 bytes)
        const unlockHex = data.slice(386, 450); // 7th field (unlockDate)
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`UNCX/TF V3 onLock - Pool/Token: ${poolAddress}, Unlock: ${unlockTime}`);
        return { tokenAddress: poolAddress, amount: null, unlockTime, version: "V3" };
      }
      
      console.log(`UNCX/TF V3 onLock - Data too short: ${data.length}`);
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V3" };
    }
    
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown" };
  } catch (err) {
    console.error("Token extraction error:", err.message);
    return { tokenAddress: null, amount: null, unlockTime: null, version: "Unknown" };
  }
}

// Fetch token metadata from blockchain with RPC fallbacks
async function getTokenInfo(tokenAddress, chainId) {
  const rpcUrls = RPC_URLS[chainId];
  if (!rpcUrls || rpcUrls.length === 0) {
    console.error(`No RPC URLs for chain ${chainId}`);
    return null;
  }
  
  // Validate address format
  if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
    console.error(`Invalid token address: ${tokenAddress}`);
    return null;
  }
  
  // Try each RPC endpoint
  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i];
    try {
      console.log(`[Attempt ${i + 1}/${rpcUrls.length}] Fetching token info for ${tokenAddress} on chain ${chainId}`);
      console.log(`Using RPC: ${rpcUrl}`);
      
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      
      console.log(`Calling contract methods...`);
      
      // Add timeout for each call
      const timeout = (ms) => new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      );
      
      const [symbol, decimals, totalSupply] = await Promise.all([
        Promise.race([contract.symbol(), timeout(3000)]),
        Promise.race([contract.decimals(), timeout(3000)]),
        Promise.race([contract.totalSupply(), timeout(3000)])
      ]);
      
      console.log(`✅ Token info: ${symbol}, decimals: ${decimals}`);
      
      return { 
        symbol, 
        decimals: Number(decimals), 
        totalSupply: totalSupply.toString() 
      };
    } catch (err) {
      console.error(`❌ RPC ${rpcUrl} failed:`, err.message);
      // If this was the last RPC, return null
      if (i === rpcUrls.length - 1) {
        console.error("All RPCs failed for token info");
        return null;
      }
      // Otherwise continue to next RPC
      console.log(`Trying next RPC...`);
    }
  }
  
  return null;
}

// Fetch price and security data
async function enrichTokenData(tokenAddress, chainId) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    console.log(`Starting enrichment for ${tokenAddress} on ${chainName}`);
    
    // DexScreener for price/liquidity
    let price = null, liquidity = null, marketCap = null, pairCreatedAt = null;
    try {
      const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      console.log(`Fetching DexScreener: ${dexUrl}`);
      const dexRes = await axios.get(dexUrl, { timeout: 5000 });
      
      if (dexRes.data?.pairs?.length > 0) {
        const pair = dexRes.data.pairs[0];
        price = parseFloat(pair.priceUsd) || null;
        liquidity = parseFloat(pair.liquidity?.usd) || null;
        marketCap = parseFloat(pair.marketCap) || null;
        pairCreatedAt = pair.pairCreatedAt || null;
        console.log(`✅ DexScreener: price=${price}, liq=${liquidity}, mc=${marketCap}`);
      } else {
        console.log(`⚠️ DexScreener: No pairs found`);
      }
    } catch (dexError) {
      console.error(`❌ DexScreener error:`, dexError.message);
    }
    
    // GoPlus for security
    let securityFlags = {};
    try {
      const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainName}?contract_addresses=${tokenAddress}`;
      console.log(`Fetching GoPlus: ${goplusUrl}`);
      const goplusRes = await axios.get(goplusUrl, { timeout: 5000 });
      
      const secData = goplusRes.data?.result?.[tokenAddress.toLowerCase()];
      console.log(`GoPlus raw response:`, JSON.stringify(goplusRes.data?.result, null, 2));
      
      if (secData) {
        securityFlags = {
          isHoneypot: secData.is_honeypot === "1",
          isOpenSource: secData.is_open_source === "1",
          holderCount: parseInt(secData.holder_count) || 0,
          ownerBalance: parseFloat(secData.owner_percent) || 0,
          canTakeBackOwnership: secData.can_take_back_ownership === "1",
          topHolderPercent: parseFloat(secData.holder_count_top10_percent) || 0,
          lpHolderCount: parseInt(secData.lp_holder_count) || 0,
          lpTotalSupply: parseFloat(secData.lp_total_supply) || 0,
          isLpLocked: secData.is_true_token === "1" || secData.is_airdrop_scam === "0"
        };
        console.log(`✅ GoPlus: ${Object.keys(securityFlags).length} flags parsed`);
      } else {
        console.log(`⚠️ GoPlus: No security data found for ${tokenAddress.toLowerCase()}`);
      }
    } catch (goplusError) {
      console.error(`❌ GoPlus error:`, goplusError.message);
    }
    
    return { price, liquidity, marketCap, pairCreatedAt, securityFlags };
  } catch (err) {
    console.error("Enrichment error:", err.message);
    return { price: null, liquidity: null, marketCap: null, pairCreatedAt: null, securityFlags: {} };
  }
}

// Format unlock duration
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

// Format unlock date
function formatUnlockDate(unlockTime) {
  if (!unlockTime) return "Unknown";
  const date = new Date(unlockTime * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Calculate contract age from pair creation
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

// Generate DEX buy link based on chain
function getBuyLink(tokenAddress, chainId) {
  const links = {
    1: `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}`, // Ethereum
    56: `https://pancakeswap.finance/swap?outputCurrency=${tokenAddress}`, // BSC
    137: `https://quickswap.exchange/#/swap?outputCurrency=${tokenAddress}`, // Polygon
    8453: `https://app.uniswap.org/#/swap?outputCurrency=${tokenAddress}&chain=base` // Base
  };
  return links[chainId] || null;
}

// Send initial Telegram message
async function sendTelegramMessage(text) {
  const response = await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }
  );
  return response.data.result.message_id;
}

// Edit Telegram message
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

// Convert chainId to decimal
function toDecChainId(chainIdInput) {
  if (typeof chainIdInput === "number") return chainIdInput;
  if (typeof chainIdInput === "string") {
    if (chainIdInput.startsWith("0x")) return parseInt(chainIdInput, 16);
    return parseInt(chainIdInput, 10);
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    
    const body = req.body || {};
    console.log("Full incoming body:", JSON.stringify(body, null, 2));
    
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
    
    // Use shared detection logic (Team Finance + UNCX only)
    const lockResult = detectLock(body);
    
    if (!lockResult) {
      console.log("No matching lock detected");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }
    
    const { chain, type, source, explorerLink, txHash, lockLog, eventName } = lockResult;
    const chainId = toDecChainId(body.chainId);
    
    console.log(`Lock detected: Chain=${chain.name}, Source=${source}, Type=${type}, TxHash=${txHash}`);
    
    // PART 1: Save to Database (best effort - don't fail if this breaks)
    let dbSaved = false;
    try {
      const db = new LockAlertDatabase();
      
      await db.addLockAlert({
        chain,
        type,
        source,
        explorerLink,
        txHash,
        contractAddress: lockLog?.address || null,
        eventName: eventName,
        tokenAddress: null,
        tokenSymbol: null,
        tokenAmount: null,
        tokenPriceAtLock: null,
        usdValueAtLock: null
      });
      
      console.log(`✅ Saved to database: ${txHash}`);
      dbSaved = true;
    } catch (dbError) {
      console.error("⚠️ Database save failed (continuing to Telegram):", dbError.message);
    }
    
    // PART 2: Send to Telegram
    console.log("TELEGRAM_TOKEN exists:", !!TELEGRAM_TOKEN);
    console.log("TELEGRAM_GROUP_CHAT_ID exists:", !!TELEGRAM_GROUP_CHAT_ID);
    
    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials", dbSaved });
    }
    
    // Send basic notification immediately
    const basicMessage = [
      "🔒 **NEW LOCK DETECTED**",
      "",
      `🌐 Chain: ${chain.name}`,
      `🔖 Source: ${source}`,
      `📌 Type: ${type}`,
      "",
      "⏳ _Fetching token details..._",
      "",
      `[View Transaction](${explorerLink})`
    ].join("\n");
    
    const messageId = await sendTelegramMessage(basicMessage);
    console.log(`✅ Basic Telegram message sent (ID: ${messageId})`);
    
    // Respond to webhook immediately
    res.status(200).json({ 
      status: "sent",
      dbSaved,
      txHash,
      messageId
    });
    
    // PART 3: Continue enrichment in background (best effort)
    (async () => {
      // Set a maximum execution time for the entire enrichment
      const enrichmentTimeout = setTimeout(() => {
        console.error("⚠️ Enrichment timeout - updating message with partial data");
      }, 25000); // 25 seconds max
      
      try {
        console.log("Starting background enrichment...");
        
        // Extract token data from logs
        const tokenData = extractTokenData(lockLog, eventName, source);
        
        // Convert BigInt to string for logging
        console.log("Token extraction result:", JSON.stringify(tokenData, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        , 2));
        
        if (!tokenData.tokenAddress) {
          console.log("⚠️ Could not extract token address");
          await editTelegramMessage(messageId, basicMessage.replace("⏳ _Fetching token details..._", "⚠️ Could not extract token address"));
          clearTimeout(enrichmentTimeout);
          return;
        }
        
        console.log(`Token address extracted: ${tokenData.tokenAddress}`);
        
        // Get token info from blockchain
        const tokenInfo = await getTokenInfo(tokenData.tokenAddress, chainId);
        
        if (!tokenInfo) {
          console.log("⚠️ Could not fetch token info");
          const failMessage = basicMessage.replace(
            "⏳ _Fetching token details..._", 
            `⚠️ Could not fetch token info\n\nToken: \`${tokenData.tokenAddress}\``
          );
          await editTelegramMessage(messageId, failMessage);
          clearTimeout(enrichmentTimeout);
          return;
        }
        
        console.log(`Token info fetched: ${tokenInfo.symbol}`);
        
        // Calculate locked amount
        const amount = tokenData.amount ? Number(tokenData.amount) / Math.pow(10, tokenInfo.decimals) : null;
        const duration = formatDuration(tokenData.unlockTime);
        const unlockDate = formatUnlockDate(tokenData.unlockTime);
        
        // Enrich with price/security
        const enriched = await enrichTokenData(tokenData.tokenAddress, chainId);
        
        console.log(`Enrichment complete: price=${enriched.price}, liquidity=${enriched.liquidity}, marketCap=${enriched.marketCap}`);
        console.log(`Security flags:`, JSON.stringify(enriched.securityFlags, null, 2));
        
        // Calculate percentages
        const lockedPercent = amount && tokenInfo.totalSupply 
          ? ((amount / (Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals))) * 100).toFixed(2)
          : null;
        
        const usdValue = amount && enriched.price 
          ? (amount * enriched.price).toFixed(2)
          : null;
        
        // Build enriched DD snapshot message
        const parts = [
          "🔒 **NEW LOCK DETECTED**",
          ""
        ];
        
        // TOKEN INFO section
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
            ? `$${(enriched.liquidity / 1000000).toFixed(2)}M`
            : `$${(enriched.liquidity / 1000).toFixed(1)}K`;
          parts.push(`Liquidity: ${liqStr}`);
        }
        
        if (enriched.securityFlags.holderCount) {
          parts.push(`Holders: ${enriched.securityFlags.holderCount.toLocaleString()}`);
        }
        
        // Contract age
        const contractAge = formatContractAge(enriched.pairCreatedAt);
        if (contractAge) {
          parts.push(`Age: ${contractAge}`);
        }
        
        parts.push("");
        
        // LOCK DETAILS section
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
        parts.push(`Source: ${source} ${type}`);
        parts.push(`Chain: ${chain.name}`);
        
        parts.push("");
        
        // LINKS section
        parts.push("🔗 **LINKS**");
        
        const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
        const chainName = chainMap[chainId] || "ethereum";
        
        parts.push(`[DexScreener](https://dexscreener.com/${chainName}/${tokenData.tokenAddress}) | [DexTools](https://www.dextools.io/app/en/${chainName}/pair-explorer/${tokenData.tokenAddress}) | [TokenSniffer](https://tokensniffer.com/token/${chainName}/${tokenData.tokenAddress})`);
        
        // Buy link
        const buyLink = getBuyLink(tokenData.tokenAddress, chainId);
        if (buyLink) {
          parts.push(`[🛒 Buy Now](${buyLink})`);
        }
        
        parts.push("");
        
        // QUICK CHECK section (security flags)
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
          
          // Top holder concentration
          if (enriched.securityFlags.topHolderPercent > 70) {
            parts.push(`🔴 Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
          } else if (enriched.securityFlags.topHolderPercent > 50) {
            parts.push(`⚠️ Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
          }
          
          // LP lock status
          if (enriched.securityFlags.lpHolderCount > 0) {
            parts.push(`💧 LP: ${enriched.securityFlags.lpHolderCount} holders`);
          }
          
          parts.push("");
        }
        
        parts.push(`[View Transaction](${explorerLink})`);
        
        const enrichedMessage = parts.join("\n");
        
        await editTelegramMessage(messageId, enrichedMessage);
        
        console.log("✅ Enriched message updated successfully");
        clearTimeout(enrichmentTimeout);
        
      } catch (enrichError) {
        clearTimeout(enrichmentTimeout);
        console.error("❌ Enrichment failed:", enrichError.message, enrichError.stack);
        
        // Try to at least show the token address if we have it
        try {
          const tokenData = extractTokenData(lockLog, eventName, source);
          if (tokenData.tokenAddress) {
            const errorMessage = basicMessage.replace(
              "⏳ _Fetching token details..._",
              `⚠️ Enrichment failed\n\nToken: \`${tokenData.tokenAddress}\`\n\nError: ${enrichError.message}`
            );
            await editTelegramMessage(messageId, errorMessage);
          } else {
            const errorMessage = basicMessage.replace(
              "⏳ _Fetching token details..._",
              `⚠️ Enrichment failed: ${enrichError.message}`
            );
            await editTelegramMessage(messageId, errorMessage);
          }
        } catch (fallbackError) {
          console.error("❌ Even fallback message failed:", fallbackError.message);
        }
      }
    })();
    
  } catch (err) {
    console.error("❌ Webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
