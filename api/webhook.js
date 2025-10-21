const axios = require("axios");
const { ethers } = require("ethers");
const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;

// RPC endpoints for blockchain calls
const RPC_URLS = {
  1: process.env.ETHEREUM_RPC || "https://eth.llamarpc.com",
  56: process.env.BSC_RPC || "https://bsc-dataseed.binance.org",
  137: process.env.POLYGON_RPC || "https://polygon-rpc.com",
  8453: process.env.BASE_RPC || "https://mainnet.base.org"
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
    const topics = lockLog.topics || [];
    const data = lockLog.data || "0x";
    
    // Team Finance V3 uses "Deposit" event (different from V2!)
    // V3 structure: topics[1] = token, topics[2] = withdrawer, data = id + amount + unlockTime
    if (source === "Team Finance" && eventName === "Deposit") {
      const tokenAddress = topics[1] ? `0x${topics[1].slice(26)}` : null;
      
      if (data.length >= 194) {
        // Skip first 64 chars (id), then get amount and unlock
        const amountHex = data.slice(66, 130);
        const unlockHex = data.slice(130, 194);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        return { tokenAddress, amount, unlockTime, version: "V3" };
      }
      
      return { tokenAddress, amount: null, unlockTime: null, version: "V3" };
    }
    
    // UNCX V2 onDeposit
    if (eventName === "onDeposit") {
      const tokenAddress = topics[1] ? `0x${topics[1].slice(26)}` : null;
      
      if (data.length >= 194) {
        const amountHex = data.slice(2, 66);
        const unlockHex = data.slice(130, 194);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        return { tokenAddress, amount, unlockTime, version: "V2" };
      }
      
      return { tokenAddress, amount: null, unlockTime: null, version: "V2" };
    }
    
    // Team Finance V3 DepositNFT/onLock
    if (eventName === "DepositNFT" || eventName === "onLock") {
      const tokenAddress = topics[2] ? `0x${topics[2].slice(26)}` : null;
      
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

// Fetch token metadata from blockchain
async function getTokenInfo(tokenAddress, chainId) {
  try {
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) return null;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    
    const [symbol, decimals, totalSupply] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
      contract.totalSupply()
    ]);
    
    return { 
      symbol, 
      decimals: Number(decimals), 
      totalSupply: totalSupply.toString() 
    };
  } catch (err) {
    console.error("Token info fetch error:", err.message);
    return null;
  }
}

// Fetch price and security data
async function enrichTokenData(tokenAddress, chainId) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    // DexScreener for price/liquidity
    const dexUrl = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const dexRes = await axios.get(dexUrl, { timeout: 5000 });
    
    let price = null, liquidity = null, marketCap = null, pairCreatedAt = null;
    if (dexRes.data?.pairs?.length > 0) {
      const pair = dexRes.data.pairs[0];
      price = parseFloat(pair.priceUsd) || null;
      liquidity = parseFloat(pair.liquidity?.usd) || null;
      marketCap = parseFloat(pair.marketCap) || null;
      pairCreatedAt = pair.pairCreatedAt || null; // Timestamp for contract age
    }
    
    // GoPlus for security
    const goplusUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainName}?contract_addresses=${tokenAddress}`;
    const goplusRes = await axios.get(goplusUrl, { timeout: 5000 });
    
    let securityFlags = {};
    const secData = goplusRes.data?.result?.[tokenAddress.toLowerCase()];
    if (secData) {
      securityFlags = {
        isHoneypot: secData.is_honeypot === "1",
        isOpenSource: secData.is_open_source === "1",
        holderCount: parseInt(secData.holder_count) || 0,
        ownerBalance: parseFloat(secData.owner_percent) || 0,
        canTakeBackOwnership: secData.can_take_back_ownership === "1",
        // New fields for top holders and LP lock
        topHolderPercent: parseFloat(secData.holder_count_top10_percent) || 0,
        lpHolderCount: parseInt(secData.lp_holder_count) || 0,
        lpTotalSupply: parseFloat(secData.lp_total_supply) || 0,
        isLpLocked: secData.is_true_token === "1" || secData.is_airdrop_scam === "0"
      };
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
      try {
        console.log("Starting background enrichment...");
        
        // Extract token data from logs
        const tokenData = extractTokenData(lockLog, eventName, source);
        
        if (!tokenData.tokenAddress) {
          console.log("⚠️ Could not extract token address");
          await editTelegramMessage(messageId, basicMessage.replace("⏳ _Fetching token details..._", "⚠️ Could not extract token address"));
          return;
        }
        
        console.log(`Token address extracted: ${tokenData.tokenAddress}`);
        
        // Get token info from blockchain
        const tokenInfo = await getTokenInfo(tokenData.tokenAddress, chainId);
        
        if (!tokenInfo) {
          console.log("⚠️ Could not fetch token info");
          await editTelegramMessage(messageId, basicMessage.replace("⏳ _Fetching token details..._", "⚠️ Could not fetch token info"));
          return;
        }
        
        console.log(`Token info fetched: ${tokenInfo.symbol}`);
        
        // Calculate locked amount
        const amount = tokenData.amount ? Number(tokenData.amount) / Math.pow(10, tokenInfo.decimals) : null;
        const duration = formatDuration(tokenData.unlockTime);
        const unlockDate = formatUnlockDate(tokenData.unlockTime);
        
        // Enrich with price/security
        const enriched = await enrichTokenData(tokenData.tokenAddress, chainId);
        
        console.log(`Enrichment complete: price=${enriched.price}, liquidity=${enriched.liquidity}`);
        
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
          parts.push(`Value: $${Number(usdValue).toLocaleString()}`);
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
        const hasSecurityInfo = enriched.securityFlags.isHoneypot !== undefined;
        
        if (hasSecurityInfo) {
          parts.push("⚡ **QUICK CHECK**");
          
          if (enriched.securityFlags.isOpenSource) {
            parts.push("✅ Verified contract");
          } else {
            parts.push("⚠️ Not verified");
          }
          
          if (enriched.securityFlags.isHoneypot === false) {
            parts.push("✅ Not honeypot");
          } else if (enriched.securityFlags.isHoneypot === true) {
            parts.push("🔴 Honeypot detected!");
          }
          
          if (enriched.securityFlags.canTakeBackOwnership) {
            parts.push("⚠️ Can take back ownership");
          }
          
          if (enriched.securityFlags.ownerBalance > 50) {
            parts.push(`🔴 Owner holds ${enriched.securityFlags.ownerBalance.toFixed(1)}%`);
          } else if (enriched.securityFlags.ownerBalance > 20) {
            parts.push(`⚠️ Owner holds ${enriched.securityFlags.ownerBalance.toFixed(1)}%`);
          }
          
          // Top holder concentration
          if (enriched.securityFlags.topHolderPercent > 0) {
            if (enriched.securityFlags.topHolderPercent > 70) {
              parts.push(`🔴 Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
            } else if (enriched.securityFlags.topHolderPercent > 50) {
              parts.push(`⚠️ Top 10 holders: ${enriched.securityFlags.topHolderPercent.toFixed(1)}%`);
            }
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
        
      } catch (enrichError) {
        console.error("❌ Enrichment failed:", enrichError.message, enrichError.stack);
      }
    })();
    
  } catch (err) {
    console.error("❌ Webhook error:", err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
