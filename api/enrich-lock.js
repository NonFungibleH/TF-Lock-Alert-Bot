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
    "https://eth.drpc.org",
    "https://rpc.ankr.com/eth",
    "https://1rpc.io/eth"
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

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
];

const LP_TOKEN_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const UNISWAP_V3_NFT_ABI = [
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
];

// Compute Uniswap V3 pool address from token0, token1, and fee
function computePoolAddress(token0, token1, fee, chainId) {
  // Uniswap V3 factory addresses by chain
  const factoryAddresses = {
    1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',    // Ethereum
    56: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',   // BSC (PancakeSwap V3)
    137: '0x1F98431c8aD98523631AE4a59f267346ea31F984',  // Polygon
    8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD'  // Base
  };
  
  const factory = factoryAddresses[chainId];
  if (!factory) return null;
  
  // Sort tokens
  const [tokenA, tokenB] = token0.toLowerCase() < token1.toLowerCase() 
    ? [token0, token1] 
    : [token1, token0];
  
  // Compute pool address using CREATE2
  const initCodeHash = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54'; // Uniswap V3 pool init code hash
  
  const salt = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24'],
      [tokenA, tokenB, fee]
    )
  );
  
  const poolAddress = ethers.utils.getCreate2Address(factory, salt, initCodeHash);
  
  console.log(`✅ Computed pool address: ${poolAddress}`);
  return poolAddress;
}

// Query Uniswap V3 NFT position to get pool and token details
async function queryNFTPosition(nftManagerAddress, tokenId, chainId) {
  try {
    const rpcUrls = RPC_URLS[chainId];
    if (!rpcUrls || rpcUrls.length === 0) return null;
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
    const nftManager = new ethers.Contract(nftManagerAddress, UNISWAP_V3_NFT_ABI, provider);
    
    const position = await nftManager.positions(tokenId);
    
    const token0 = position.token0;
    const token1 = position.token1;
    const fee = position.fee;
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const liquidity = position.liquidity;
    const tokensOwed0 = position.tokensOwed0;
    const tokensOwed1 = position.tokensOwed1;
    
    console.log(`✅ NFT Position: token0=${token0}, token1=${token1}, liquidity=${liquidity.toString()}, fee=${fee/10000}%`);
    
    // Compute pool address
    const poolAddress = computePoolAddress(token0, token1, fee, chainId);
    
    // Determine primary token (non-wrapped native)
    const wrappedNativeTokens = [
      '0x4200000000000000000000000000000000000006',
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
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
      primaryToken = token0;
      pairedToken = token1;
      isPrimaryToken0 = true;
    }
    
    return {
      token0,
      token1,
      primaryToken,
      pairedToken,
      isPrimaryToken0,
      poolAddress,
      lpPosition: {
        liquidity,
        feeTier: fee,
        tickLower,
        tickUpper,
        tokensOwed0,
        tokensOwed1
      }
    };
  } catch (err) {
    console.error(`Failed to query NFT position: ${err.message}`);
    return null;
  }
}

// Check if a token address is an LP token and extract underlying tokens
async function checkIfLPToken(tokenAddress, chainId) {
  try {
    const rpcUrls = RPC_URLS[chainId];
    if (!rpcUrls || rpcUrls.length === 0) return null;
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
    const contract = new ethers.Contract(tokenAddress, LP_TOKEN_ABI, provider);
    
    try {
      // Try to call token0() and token1() - if they exist, it's an LP token
      const [token0, token1] = await Promise.all([
        contract.token0(),
        contract.token1()
      ]);
      
      console.log(`✅ LP Token detected: token0=${token0}, token1=${token1}`);
      
      // Determine primary token (non-wrapped native)
      const wrappedNativeTokens = [
        '0x4200000000000000000000000000000000000006',
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
        '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
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
      
      return {
        isLP: true,
        token0,
        token1,
        primaryToken,
        pairedToken,
        isPrimaryToken0
      };
    } catch (err) {
      // If token0() or token1() don't exist, it's not an LP token
      console.log(`Not an LP token: ${err.message}`);
      return { isLP: false };
    }
  } catch (err) {
    console.error(`Error checking if LP token: ${err.message}`);
    return { isLP: false };
  }
}

// Detect if lock fee was paid or whitelisted
function detectLockFee(txData, lockContractAddress, chainId) {
  try {
    // Check for internal transactions (ETH/BNB transfers)
    const txsInternal = txData.txsInternal || [];
    
    // Look for value transfer to the lock contract
    const feePaid = txsInternal.find(tx => 
      tx.to && tx.to.toLowerCase() === lockContractAddress.toLowerCase() && 
      tx.value && parseFloat(tx.value) > 0
    );
    
    if (feePaid) {
      const feeInNative = parseFloat(feePaid.value) / 1e18;
      return {
        paid: true,
        amount: feeInNative,
        whitelisted: false
      };
    }
    
    // Also check main transaction value
    const txs = txData.txs || [];
    if (txs.length > 0) {
      const mainTx = txs[0];
      if (mainTx.value && parseFloat(mainTx.value) > 0) {
        const feeInNative = parseFloat(mainTx.value) / 1e18;
        return {
          paid: true,
          amount: feeInNative,
          whitelisted: false
        };
      }
    }
    
    // No fee found = whitelisted
    return {
      paid: false,
      amount: 0,
      whitelisted: true
    };
  } catch (err) {
    console.error("Lock fee detection error:", err.message);
    return null;
  }
}

// Extract lock owner address from event data
function extractLockOwner(lockLog, eventName, source) {
  try {
    const topics = lockLog.topics || [];
    const topicsArray = topics.length > 0 ? topics : [
      lockLog.topic0,
      lockLog.topic1, 
      lockLog.topic2,
      lockLog.topic3
    ].filter(t => t !== null && t !== undefined);
    
    const data = lockLog.data || "0x";
    
    // Team Finance V3 Deposit: owner is in topic2
    if (source === "Team Finance" && eventName === "Deposit") {
      return topicsArray[2] ? `0x${topicsArray[2].slice(26)}` : null;
    }
    
    // Team Finance V2 onDeposit: owner is at offset 64 in data
    if (eventName === "onDeposit") {
      if (data.length >= 130) {
        return `0x${data.slice(90, 130)}`;
      }
    }
    
    // UNCX V2 onNewLock: owner is at offset 128 in data
    if (eventName === "onNewLock" && source === "UNCX") {
      if (data.length >= 192) {
        return `0x${data.slice(154, 194)}`;
      }
    }
    
    // UNCX V3 onLock: owner is at offset 192 in data
    if (eventName === "onLock" && source === "UNCX") {
      if (data.length >= 256) {
        return `0x${data.slice(218, 258)}`;
      }
    }
    
    // Team Finance V3 DepositNFT: owner is in topic2
    if (eventName === "DepositNFT") {
      return topicsArray[2] ? `0x${topicsArray[2].slice(26)}` : null;
    }
    
    return null;
  } catch (err) {
    console.error("Owner extraction error:", err.message);
    return null;
  }
}

// Check for unusual lock patterns
function detectUnusualPatterns(lockedPercent, unlockTime, usdValue, isLPLock) {
  const warnings = [];
  
  if (!unlockTime) return warnings;
  
  const now = Math.floor(Date.now() / 1000);
  const duration = unlockTime - now;
  const durationDays = duration / 86400;
  
  // Pattern 1: High % but very short duration (< 1 day)
  if (lockedPercent && lockedPercent > 80 && durationDays < 1) {
    warnings.push('⚠️ High % locked but only ' + formatDuration(unlockTime) + ' duration');
  }
  
  // Pattern 2: Low % locked (< 5%)
  if (lockedPercent && lockedPercent < 5) {
    warnings.push('⚠️ Less than 5% of supply locked');
  }
  
  // Pattern 3: LP lock but tiny USD value
  if (isLPLock && usdValue && parseFloat(usdValue) < 1000) {
    warnings.push('⚠️ LP lock value under $1,000');
  }
  
  // Pattern 4: Very short duration (< 1 week) regardless of %
  if (durationDays < 7) {
    warnings.push('⚠️ Lock duration less than 1 week');
  }
  
  // Pattern 5: Already unlocked or about to unlock
  if (duration < 3600) { // < 1 hour
    warnings.push('🔴 Lock expires in less than 1 hour!');
  }
  
  return warnings;
}

// Get wallet's token holdings count
async function getWalletTokenCount(walletAddress, chainId) {
  try {
    // Use a simple approach: check token transfer events to this address
    // For now, we'll return null and can enhance later with proper indexer
    // This would require an indexer API like Moralis, Alchemy, etc.
    console.log(`Wallet token count check skipped for ${walletAddress} (requires paid API)`);
    return null;
  } catch (err) {
    console.error("Wallet token count error:", err.message);
    return null;
  }
}

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
        
        // NEW: Check if this is an LP token by trying to fetch token0/token1
        // LP tokens have token0() and token1() functions, regular tokens don't
        console.log(`onDeposit: Checking if ${tokenAddress} is an LP token...`);
        
        return { 
          tokenAddress, 
          amount, 
          unlockTime, 
          version: "V2", 
          isLPLock: false,  // Will be updated after checking if it's LP
          lpPosition: null,
          needsLPCheck: true  // Flag to check if this is an LP token
        };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V2", isLPLock: false, lpPosition: null };
    }
    
    // UNCX V2 Uniswap: onNewLock event
    if (eventName === "onNewLock" && source === "UNCX") {
      if (data.length >= 384) {
        const tokenAddress = `0x${data.slice(90, 130)}`;
        const amountHex = data.slice(194, 258);
        const unlockHex = data.slice(322, 386);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`UNCX V2 onNewLock: token=${tokenAddress}, amount=${amount.toString()}, unlock=${new Date(unlockTime * 1000).toISOString()}`);
        
        return { 
          tokenAddress, 
          amount, 
          unlockTime, 
          version: "UNCX V2", 
          isLPLock: false,
          lpPosition: null,
          needsLPCheck: true  // Flag to check if this is an LP token
        };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "UNCX V2", isLPLock: false, lpPosition: null };
    }
    
    if (source === "Team Finance" && eventName === "DepositNFT") {
      const nftManagerAddress = topicsArray[1] ? `0x${topicsArray[1].slice(26)}` : null;
      if (data.length >= 258) {
        const tokenIdHex = data.slice(2, 66);
        const amountHex = data.slice(130, 194);
        const unlockHex = data.slice(194, 258);
        const tokenId = BigInt(`0x${tokenIdHex}`);
        const amount = BigInt(`0x${amountHex}`);
        const unlockTime = parseInt(unlockHex, 16);
        
        console.log(`Team Finance V3 NFT Lock: nftManager=${nftManagerAddress}, tokenId=${tokenId.toString()}, unlock=${new Date(unlockTime * 1000).toISOString()}`);
        
        // This is a V3 LP position NFT - needs on-chain query to get position details
        return { 
          tokenAddress: nftManagerAddress, 
          tokenId,
          amount, 
          unlockTime, 
          version: "V3", 
          isLPLock: true, 
          lpPosition: null,
          needsNFTPositionQuery: true  // Flag to query NFT position data
        };
      }
      return { tokenAddress: null, amount: null, unlockTime: null, version: "V3", isLPLock: false, lpPosition: null };
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
      if (data.length >= 896) {
        const unlockHex = data.slice(386, 450);
        const unlockTimeRaw = parseInt(unlockHex, 16);
        
        // Handle permanent locks (max uint256 = 0xfff...fff)
        // JavaScript's max safe timestamp is around year 275760
        const MAX_SAFE_TIMESTAMP = 8640000000000; // Year 275760 in seconds
        const unlockTime = unlockTimeRaw > MAX_SAFE_TIMESTAMP ? null : unlockTimeRaw;
        
        const poolAddress = `0x${data.slice(602, 642)}`;
        const token0 = `0x${data.slice(794, 834)}`;
        const token1 = `0x${data.slice(858, 898)}`;
        
        const lpPosition = extractLPPositionData(lockLog);
        
        const wrappedNativeTokens = [
          '0x4200000000000000000000000000000000000006',
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
          '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
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
          primaryToken = token0;
          pairedToken = token1;
          isPrimaryToken0 = true;
        }
        
        const unlockDateStr = unlockTime ? new Date(unlockTime * 1000).toISOString() : 'PERMANENT';
        console.log(`UNCX LP Lock: token0=${token0}, token1=${token1}, primary=${primaryToken}, pool=${poolAddress}, unlock=${unlockDateStr}`);
        
        return { 
          tokenAddress: primaryToken, 
          token1: pairedToken,
          poolAddress,
          isPrimaryToken0,
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
  
  console.log(`Trying ${rpcUrls.length} RPCs in parallel for faster response...`);
  
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
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    // Wrapped native token addresses to search for price
    const wrappedNativeTokens = {
      1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',    // WETH
      56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',   // WBNB
      137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',  // WMATIC/WPOL
      8453: '0x4200000000000000000000000000000000000006'  // WETH on Base
    };
    
    const nativeTokenAddress = wrappedNativeTokens[chainId];
    if (!nativeTokenAddress) return null;
    
    console.log(`Fetching native token price for ${chainName}...`);
    
    // Try DexScreener first
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${nativeTokenAddress}`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (response.data?.pairs && response.data.pairs.length > 0) {
        const chainPairs = response.data.pairs.filter(p => p.chainId === chainName);
        
        if (chainPairs.length > 0) {
          // Find USD pair (paired with USDC/USDT)
          const usdPair = chainPairs.find(p => 
            p.quoteToken?.symbol === 'USDC' || 
            p.quoteToken?.symbol === 'USDT' ||
            p.quoteToken?.symbol === 'DAI'
          );
          
          if (usdPair && usdPair.priceUsd) {
            const price = parseFloat(usdPair.priceUsd);
            console.log(`✅ Native token price from DexScreener: $${price}`);
            return price;
          }
          
          // Fallback to highest liquidity pair
          const bestPair = chainPairs.sort((a, b) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          )[0];
          
          if (bestPair && bestPair.priceUsd) {
            const price = parseFloat(bestPair.priceUsd);
            console.log(`✅ Native token price from DexScreener (best pair): $${price}`);
            return price;
          }
        }
      }
    } catch (err) {
      console.log(`DexScreener native price failed: ${err.message}`);
    }
    
    // Try DexTools as fallback
    try {
      const url = `https://www.dextools.io/shared/search/pair?query=${nativeTokenAddress}`;
      const response = await axios.get(url, { 
        timeout: 5000,
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
          const price = parseFloat(chainPairs[0].price);
          console.log(`✅ Native token price from DexTools: $${price}`);
          return price;
        }
      }
    } catch (err) {
      console.log(`DexTools native price failed: ${err.message}`);
    }
    
    console.log(`❌ Could not fetch native token price for ${chainName}`);
    return null;
    
  } catch (err) {
    console.error("Failed to fetch native token price:", err.message);
    return null;
  }
}

// NEW: Get current pool state to calculate exact token amounts
async function getPoolState(poolAddress, chainId) {
  try {
    const rpcUrls = RPC_URLS[chainId];
    if (!rpcUrls || rpcUrls.length === 0) return null;
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
    const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    const slot0 = await poolContract.slot0();
    console.log(`✅ Pool state: tick=${slot0.tick}, sqrtPriceX96=${slot0.sqrtPriceX96.toString()}`);
    
    return {
      tick: slot0.tick,
      sqrtPriceX96: slot0.sqrtPriceX96.toString()
    };
  } catch (err) {
    console.error("Failed to get pool state:", err.message);
    return null;
  }
}

// NEW: Calculate token amounts from V3 position with actual pool state
function calculateTokenAmountsFromPosition(liquidity, tickLower, tickUpper, currentTick, decimals0, decimals1) {
  try {
    const liquidityBN = BigInt(liquidity);
    if (liquidityBN === 0n) return { amount0: 0, amount1: 0 };
    
    // Helper function to get sqrt price at tick
    const getSqrtRatioAtTick = (tick) => {
      const absTick = Math.abs(tick);
      let ratio = BigInt(absTick & 0x1) !== 0n ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001') : BigInt('0x100000000000000000000000000000000');
      
      if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> 128n;
      if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n;
      if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n;
      if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> 128n;
      if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> 128n;
      if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> 128n;
      if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> 128n;
      if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> 128n;
      if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> 128n;
      if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> 128n;
      if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> 128n;
      if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> 128n;
      if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> 128n;
      if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> 128n;
      if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> 128n;
      if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> 128n;
      if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> 128n;
      if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> 128n;
      if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> 128n;
      
      if (tick > 0) ratio = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') / ratio;
      
      return ratio >> 32n;
    };
    
    let amount0 = 0n;
    let amount1 = 0n;
    
    if (currentTick < tickLower) {
      // Position is entirely in token0
      const sqrtRatioA = getSqrtRatioAtTick(tickLower);
      const sqrtRatioB = getSqrtRatioAtTick(tickUpper);
      amount0 = (liquidityBN * (sqrtRatioB - sqrtRatioA)) / (BigInt(2) ** BigInt(96)) / sqrtRatioA;
    } else if (currentTick >= tickUpper) {
      // Position is entirely in token1
      const sqrtRatioA = getSqrtRatioAtTick(tickLower);
      const sqrtRatioB = getSqrtRatioAtTick(tickUpper);
      amount1 = liquidityBN * (sqrtRatioB - sqrtRatioA) / (BigInt(2) ** BigInt(96));
    } else {
      // Position is active (in range)
      const sqrtRatioA = getSqrtRatioAtTick(tickLower);
      const sqrtRatioB = getSqrtRatioAtTick(tickUpper);
      const sqrtRatioCurrent = getSqrtRatioAtTick(currentTick);
      
      amount0 = (liquidityBN * (sqrtRatioB - sqrtRatioCurrent)) / (BigInt(2) ** BigInt(96)) / sqrtRatioCurrent;
      amount1 = liquidityBN * (sqrtRatioCurrent - sqrtRatioA) / (BigInt(2) ** BigInt(96));
    }
    
    // Convert to human readable
    const amount0Readable = Number(amount0) / Math.pow(10, decimals0);
    const amount1Readable = Number(amount1) / Math.pow(10, decimals1);
    
    console.log(`✅ Calculated amounts: token0=${amount0Readable}, token1=${amount1Readable}`);
    
    return { 
      amount0: amount0Readable, 
      amount1: amount1Readable 
    };
  } catch (err) {
    console.error("Token amount calculation error:", err.message);
    return { amount0: 0, amount1: 0 };
  }
}

function extractLPPositionData(lockLog) {
  try {
    const data = lockLog.data || "0x";
    
    if (data.length < 1408) {
      console.log(`Data too short for full LP extraction: ${data.length} chars`);
      return null;
    }
    
    const liquidityHex = data.slice(1090, 1154);
    const liquidity = BigInt(`0x${liquidityHex}`);
    
    const feeHex = data.slice(898, 962);
    const feeTier = parseInt(feeHex, 16);
    
    const tickLowerHex = data.slice(1020, 1026);
    const tickUpperHex = data.slice(1084, 1090);
    
    let tickLower = parseInt(tickLowerHex, 16);
    if (tickLower > 0x7FFFFF) tickLower -= 0x1000000;
    
    let tickUpper = parseInt(tickUpperHex, 16);
    if (tickUpper > 0x7FFFFF) tickUpper -= 0x1000000;
    
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

async function enrichTokenData(tokenAddress, chainId, poolAddress = null) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId];
    
    console.log(`Fetching enrichment data for ${tokenAddress} on ${chainName}`);
    
    let dexScreenerData = null;
    let dexToolsData = null;
    let goPlusData = null;
    
    // Try DexScreener first
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
          
          const nativeTokenAddresses = {
            1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
            8453: '0x4200000000000000000000000000000000000006'
          };
          
          const quoteTokenAddress = bestPair.quoteToken?.address?.toLowerCase();
          const nativeAddress = nativeTokenAddresses[chainId]?.toLowerCase();
          const isNativePair = quoteTokenAddress === nativeAddress;
          
          const nativeTokenAmount = isNativePair && bestPair.liquidity?.quote 
            ? parseFloat(bestPair.liquidity.quote) 
            : null;
          
          if (nativeTokenAmount) {
            console.log(`✅ Native token in pair: ${nativeTokenAmount} ${bestPair.quoteToken?.symbol}`);
          }
          
          dexScreenerData = {
            price: bestPair.priceUsd ? parseFloat(bestPair.priceUsd) : null,
            marketCap: bestPair.marketCap || null,
            liquidity: bestPair.liquidity?.usd || null,
            nativeTokenAmount: nativeTokenAmount,
            pairName: `${bestPair.baseToken?.symbol || ''}/${bestPair.quoteToken?.symbol || ''}`,
            pairAddress: bestPair.pairAddress || null,
            pairCreatedAt: bestPair.pairCreatedAt || null,
            // NEW: Extract price changes
            priceChange5m: bestPair.priceChange?.m5 || null,
            priceChange1h: bestPair.priceChange?.h1 || null,
            priceChange6h: bestPair.priceChange?.h6 || null,
            priceChange24h: bestPair.priceChange?.h24 || null,
            // NEW: Extract volume
            volume24h: bestPair.volume?.h24 || null,
            buyVolume24h: bestPair.volume?.h24Buy || null,
            sellVolume24h: bestPair.volume?.h24Sell || null,
            // NEW: Extract buys/sells
            txns24h: bestPair.txns?.h24 || null,
            // NEW: Extract makers (unique traders)
            makers24h: {
              buyers: bestPair.txns?.h24?.buyers || null,
              sellers: bestPair.txns?.h24?.sellers || null
            },
            source: 'DexScreener'
          };
        }
      }
      
      if (!dexScreenerData) {
        console.log(`DexScreener: No pairs for ${chainName}`);
      }
    } catch (err) {
      console.log(`DexScreener failed: ${err.message}`);
    }
    
    // Try DexTools (for additional metrics like txns, buy/sell tax)
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
          
          dexToolsData = {
            price: bestPair.price || null,
            marketCap: bestPair.metrics?.marketCap || null,
            liquidity: bestPair.metrics?.liquidity || null,
            totalTransactions: bestPair.metrics?.transactions || null,
            buyTax: bestPair.metrics?.buyTax || null,
            sellTax: bestPair.metrics?.sellTax || null,
            pairName: bestPair.name || null,
            source: 'DexTools'
          };
          
          if (dexToolsData.totalTransactions) {
            console.log(`✅ DexTools: ${dexToolsData.totalTransactions} total transactions`);
          }
          if (dexToolsData.buyTax !== null || dexToolsData.sellTax !== null) {
            console.log(`✅ DexTools: Buy tax: ${dexToolsData.buyTax}%, Sell tax: ${dexToolsData.sellTax}%`);
          }
        }
      }
      
      if (!dexToolsData) {
        console.log(`DexTools: No pairs for ${chainName}`);
      }
    } catch (err) {
      console.log(`DexTools failed: ${err.message}`);
    }
    
    // Try GoPlus for security data
    try {
      const secUrl = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${tokenAddress}`;
      const secResponse = await axios.get(secUrl, { timeout: 5000 });
      const secResult = secResponse.data?.result?.[tokenAddress.toLowerCase()];
      
      if (secResult) {
        goPlusData = {
          isOpenSource: secResult.is_open_source === "1",
          isHoneypot: secResult.is_honeypot === "1",
          canTakeBackOwnership: secResult.can_take_back_ownership === "1",
          ownerBalance: parseFloat(secResult.owner_percent || 0) * 100,
          holderCount: parseInt(secResult.holder_count || 0),
          topHolderPercent: parseFloat(secResult.holder_top10_percent || 0) * 100
        };
        console.log(`✅ GoPlus: holders=${goPlusData.holderCount}, top10=${goPlusData.topHolderPercent}%, verified=${goPlusData.isOpenSource}`);
      }
    } catch (secErr) {
      console.log(`GoPlus failed: ${secErr.message}`);
    }
    
    // Merge data from all sources (prefer DexScreener for price/liquidity, DexTools for metrics)
    const mergedData = {
      price: dexScreenerData?.price || dexToolsData?.price || null,
      marketCap: dexScreenerData?.marketCap || dexToolsData?.marketCap || null,
      liquidity: dexScreenerData?.liquidity || dexToolsData?.liquidity || null,
      nativeTokenAmount: dexScreenerData?.nativeTokenAmount || null,
      pairName: dexScreenerData?.pairName || dexToolsData?.pairName || null,
      pairAddress: dexScreenerData?.pairAddress || null,
      pairCreatedAt: dexScreenerData?.pairCreatedAt || null,
      totalTransactions: dexToolsData?.totalTransactions || null,
      buyTax: dexToolsData?.buyTax || null,
      sellTax: dexToolsData?.sellTax || null,
      // NEW: Price changes
      priceChange5m: dexScreenerData?.priceChange5m || null,
      priceChange1h: dexScreenerData?.priceChange1h || null,
      priceChange6h: dexScreenerData?.priceChange6h || null,
      // NEW: Volume and txns
      volume24h: dexScreenerData?.volume24h || null,
      txns24h: dexScreenerData?.txns24h || null,
      securityData: goPlusData || {},
      source: dexScreenerData ? 'DexScreener' : dexToolsData ? 'DexTools' : null
    };
    
    if (!mergedData.price && !mergedData.liquidity) {
      console.log(`❌ Could not fetch data from DexScreener or DexTools`);
    }
    
    return mergedData;
    
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
      totalTransactions: null,
      buyTax: null,
      sellTax: null,
      securityData: {},
      source: null
    };
  }
}

function formatPercentage(percent) {
  if (percent === null || percent === undefined) return null;
  
  const num = parseFloat(percent);
  
  // For very large percentages (>1000%), just show ">999%"
  if (num > 999) {
    return ">999";
  }
  
  // For percentages >= 100, show no decimals
  if (num >= 100) {
    return num.toFixed(0);
  }
  
  // For percentages >= 10, show 1 decimal
  if (num >= 10) {
    return num.toFixed(1);
  }
  
  // For percentages < 10, show 2 decimals
  return num.toFixed(2);
}

// Calculate opportunity score out of 100
function calculateOpportunityScore(data) {
  const {
    lockedPercent,
    unlockTime,
    nativeLocked,
    nativePrice,
    isVerified,
    isRenounced,
    isHoneypot,
    topHolderPercent,
    holderCount,
    tokenAgeMinutes,
    poolAgeMinutes,
    buysSells,
    volume24h,
    liquidity
  } = data;
  
  let score = 0;
  const breakdown = {};
  
  // === CRITICAL FAILURES - Auto-cap score at 20 ===
  const nativeLockedUSD = (nativeLocked && nativePrice) ? (nativeLocked * nativePrice) : 0;
  const ageMinutes = tokenAgeMinutes || poolAgeMinutes || 0;
  const totalTxns = buysSells ? ((buysSells.buys || 0) + (buysSells.sells || 0)) : 0;
  
  let criticalFailure = false;
  
  // Critical: Less than $500 locked
  if (nativeLockedUSD < 500) {
    criticalFailure = true;
  }
  
  // Critical: No volume and very new
  if (volume24h === 0 && ageMinutes < 1440) { // Less than 1 day old with $0 volume
    criticalFailure = true;
  }
  
  // Critical: Less than 10 transactions
  if (totalTxns < 10) {
    criticalFailure = true;
  }
  
  // Critical: Extremely low holder count (likely fake trading between dev wallets)
  if (holderCount && holderCount < 10) {
    criticalFailure = true;
  }
  
  // Critical: Very short lock duration (< 30 days) - easy exit scam
  if (unlockTime) {
    const now = Math.floor(Date.now() / 1000);
    const durationDays = (unlockTime - now) / 86400;
    if (durationDays < 30) {
      criticalFailure = true;
    }
  }
  
  // === LOCK QUALITY (40 points) ===
  let lockQuality = 0;
  
  // Lock duration (0-10 pts) - REDUCED from 15
  if (unlockTime) {
    const now = Math.floor(Date.now() / 1000);
    const durationDays = (unlockTime - now) / 86400;
    
    if (durationDays >= 730) lockQuality += 10; // 2+ years
    else if (durationDays >= 365) lockQuality += 8; // 1+ year
    else if (durationDays >= 180) lockQuality += 6; // 6+ months
    else if (durationDays >= 90) lockQuality += 4;  // 3+ months
    else if (durationDays >= 30) lockQuality += 2;  // 1+ month
    else lockQuality += 0; // Less than 30 days = 0 points (too short)
  }
  
  // % of liquidity locked (0-10 pts) - REDUCED from 15
  if (lockedPercent) {
    const percent = parseFloat(lockedPercent);
    if (percent >= 90) lockQuality += 10;
    else if (percent >= 75) lockQuality += 8;
    else if (percent >= 50) lockQuality += 6;
    else if (percent >= 25) lockQuality += 4;
    else lockQuality += 2;
  }
  
  // Native token locked amount (0-20 pts) - INCREASED from 10 - MOST IMPORTANT
  if (nativeLockedUSD >= 100000) lockQuality += 20;
  else if (nativeLockedUSD >= 50000) lockQuality += 16;
  else if (nativeLockedUSD >= 25000) lockQuality += 12;
  else if (nativeLockedUSD >= 10000) lockQuality += 8;
  else if (nativeLockedUSD >= 5000) lockQuality += 4;
  else if (nativeLockedUSD >= 1000) lockQuality += 2;
  else lockQuality += 0; // Less than $1k = 0 points
  
  breakdown.lockQuality = lockQuality;
  score += lockQuality;
  
  // === CONTRACT SAFETY (25 points) ===
  let contractSafety = 0;
  
  if (isVerified === true) contractSafety += 10;
  else contractSafety += 0; // Not verified = 0 points (was giving partial credit)
  
  if (isRenounced === true) contractSafety += 10;
  if (isHoneypot === false) contractSafety += 5;
  
  breakdown.contractSafety = contractSafety;
  score += contractSafety;
  
  // === TOKEN DISTRIBUTION (20 points) ===
  let distribution = 0;
  
  // Top 10 holders (0-10 pts) - lower is better
  if (topHolderPercent !== null && topHolderPercent !== undefined) {
    if (topHolderPercent <= 20) distribution += 10;
    else if (topHolderPercent <= 30) distribution += 8;
    else if (topHolderPercent <= 40) distribution += 6;
    else if (topHolderPercent <= 50) distribution += 4;
    else if (topHolderPercent <= 70) distribution += 2;
    else distribution += 0;
  }
  
  // Holder count (0-10 pts) - more is better, HEAVILY penalize low counts
  if (holderCount) {
    if (holderCount >= 1000) distribution += 10;
    else if (holderCount >= 500) distribution += 8;
    else if (holderCount >= 250) distribution += 6;
    else if (holderCount >= 100) distribution += 4;
    else if (holderCount >= 50) distribution += 2;
    else distribution += 0; // Less than 50 holders = 0 points (MAJOR RED FLAG)
  }
  
  breakdown.distribution = distribution;
  score += distribution;
  
  // === MARKET METRICS (15 points) ===
  let marketMetrics = 0;
  
  // Token age (0-4 pts) - REDUCED from 5
  if (ageMinutes) {
    const ageDays = ageMinutes / (60 * 24);
    if (ageDays >= 365) marketMetrics += 4;
    else if (ageDays >= 90) marketMetrics += 3;
    else if (ageDays >= 30) marketMetrics += 2;
    else if (ageDays >= 7) marketMetrics += 1;
    else marketMetrics += 0; // Less than 7 days = 0 points
  }
  
  // Buy/sell ratio (0-4 pts)
  if (buysSells && buysSells.buys && buysSells.sells) {
    const ratio = buysSells.buys / buysSells.sells;
    if (ratio >= 3) marketMetrics += 4;
    else if (ratio >= 2) marketMetrics += 3;
    else if (ratio >= 1.5) marketMetrics += 2;
    else if (ratio >= 1) marketMetrics += 1;
  }
  
  // Volume relative to liquidity (0-4 pts) - STRICTER
  if (volume24h && liquidity && liquidity > 0) {
    const volumeRatio = volume24h / liquidity;
    if (volumeRatio >= 1) marketMetrics += 4;
    else if (volumeRatio >= 0.5) marketMetrics += 3;
    else if (volumeRatio >= 0.25) marketMetrics += 2;
    else if (volumeRatio >= 0.1) marketMetrics += 1;
    else marketMetrics += 0; // Less than 10% = 0 points
  } else if (volume24h === 0) {
    marketMetrics += 0; // Zero volume = 0 points
  }
  
  // Activity level - makers count (0-3 pts)
  if (data.makers24h) {
    const totalMakers = (data.makers24h.buyers || 0) + (data.makers24h.sellers || 0);
    if (totalMakers >= 500) marketMetrics += 3;
    else if (totalMakers >= 200) marketMetrics += 2;
    else if (totalMakers >= 50) marketMetrics += 1;
    else marketMetrics += 0; // Less than 50 makers = 0 points
  }
  
  breakdown.marketMetrics = marketMetrics;
  score += marketMetrics;
  
  // === APPLY CRITICAL FAILURE CAP ===
  if (criticalFailure && score > 20) {
    score = Math.min(score, 20);
  }
  
  return { score, breakdown, criticalFailure };
}

// Generate smart AI-like analysis
function generateSmartAnalysis(data) {
  const {
    score,
    lockedPercent,
    unlockTime,
    nativeLocked,
    nativePrice,
    isVerified,
    isRenounced,
    isHoneypot,
    topHolderPercent,
    holderCount,
    tokenAgeMinutes,
    poolAgeMinutes,
    buysSells,
    tokenSymbol,
    isLPLock
  } = data;
  
  const parts = [];
  
  // === OPENING LINE: Age + Lock Strength ===
  let opening = '';
  const ageMinutes = tokenAgeMinutes || poolAgeMinutes || 0;
  const ageDays = ageMinutes / (60 * 24);
  
  if (ageDays < 0.04) { // < 1 hour
    opening = 'This is a **FRESH launch** ';
  } else if (ageDays < 1) {
    opening = 'This is a **NEW token** ';
  } else if (ageDays < 30) {
    opening = 'This is a **RECENT token** ';
  } else {
    opening = 'This is an **ESTABLISHED token** ';
  }
  
  const lockedPct = parseFloat(lockedPercent) || 0;
  if (isLPLock) {
    if (lockedPct >= 80) {
      opening += 'with **STRONG liquidity protection**. ';
    } else if (lockedPct >= 50) {
      opening += 'with **DECENT liquidity protection**. ';
    } else if (lockedPct >= 25) {
      opening += 'with **MODERATE liquidity protection**. ';
    } else {
      opening += 'with **WEAK liquidity protection**. ';
    }
    
    if (lockedPercent) {
      opening += `${lockedPercent}% of the pool is locked`;
    }
    
    if (unlockTime) {
      const now = Math.floor(Date.now() / 1000);
      const durationDays = (unlockTime - now) / 86400;
      if (durationDays >= 365) {
        opening += ` for ${Math.floor(durationDays / 365)}+ years`;
      } else if (durationDays >= 30) {
        opening += ` for ${Math.floor(durationDays / 30)}+ months`;
      } else if (durationDays >= 7) {
        opening += ` for ${Math.floor(durationDays / 7)}+ weeks`;
      } else {
        opening += ` for only ${Math.floor(durationDays)} days`;
      }
    }
  } else {
    opening += 'with token locks in place';
  }
  
  if (nativeLocked && nativePrice) {
    const usdValue = nativeLocked * nativePrice;
    if (usdValue >= 10000) {
      const usdStr = usdValue >= 1000000 
        ? `$${(usdValue / 1000000).toFixed(1)}M`
        : `$${(usdValue / 1000).toFixed(0)}K`;
      opening += ` with ${usdStr} in native tokens secured.`;
    } else {
      opening += '.';
    }
  } else {
    opening += '.';
  }
  
  parts.push(opening);
  
  // === STRENGTHS (positive signals) ===
  const strengths = [];
  
  if (isVerified && isRenounced) {
    strengths.push('contract verified & renounced');
  } else if (isVerified) {
    strengths.push('contract verified');
  } else if (isRenounced) {
    strengths.push('ownership renounced');
  }
  
  if (isHoneypot === false) {
    strengths.push('not a honeypot');
  }
  
  if (lockedPct >= 75 && isLPLock) {
    strengths.push('high liquidity locked');
  }
  
  if (buysSells && buysSells.buys && buysSells.sells) {
    const ratio = buysSells.buys / buysSells.sells;
    if (ratio >= 2) {
      strengths.push(`strong buy pressure (${ratio.toFixed(1)}x more buys)`);
    }
  }
  
  if (topHolderPercent !== null && topHolderPercent <= 30) {
    strengths.push('well-distributed holdings');
  }
  
  if (holderCount >= 500) {
    strengths.push(`${holderCount.toLocaleString()} holders`);
  }
  
  if (strengths.length > 0) {
    parts.push(`\n\n✅ **Strengths:** ${strengths.join(', ')}`);
  }
  
  // === RISKS (warning signals) ===
  const risks = [];
  
  if (ageDays < 1) {
    if (ageDays < 0.04) {
      risks.push('extremely new (< 1 hour old)');
    } else {
      risks.push('very new token');
    }
  }
  
  if (topHolderPercent !== null && topHolderPercent > 50) {
    risks.push(`highly concentrated (top 10 hold ${topHolderPercent.toFixed(0)}%)`);
  } else if (topHolderPercent !== null && topHolderPercent > 40) {
    risks.push(`concentrated holdings (top 10 hold ${topHolderPercent.toFixed(0)}%)`);
  }
  
  if (lockedPct < 50 && isLPLock) {
    risks.push('low liquidity lock');
  }
  
  if (unlockTime) {
    const now = Math.floor(Date.now() / 1000);
    const durationDays = (unlockTime - now) / 86400;
    if (durationDays < 7) {
      risks.push('lock expires soon');
    }
  }
  
  if (!isVerified) {
    risks.push('contract not verified');
  }
  
  if (!isRenounced) {
    risks.push('owner can still control contract');
  }
  
  if (holderCount && holderCount < 50) {
    risks.push('very few holders');
  }
  
  if (risks.length > 0) {
    parts.push(`\n⚠️ **Risks:** ${risks.join(', ')}`);
  }
  
  // === BOTTOM LINE ===
  let bottomLine = '\n\n**Bottom Line:** ';
  
  if (score >= 80) {
    bottomLine += 'Excellent fundamentals with strong protection. ';
  } else if (score >= 70) {
    bottomLine += 'Good setup with solid risk management. ';
  } else if (score >= 60) {
    bottomLine += 'Decent fundamentals but some concerns. ';
  } else if (score >= 50) {
    bottomLine += 'Mixed signals - moderate risk. ';
  } else {
    bottomLine += 'Weak fundamentals - high risk. ';
  }
  
  if (ageDays < 1) {
    bottomLine += 'Early entry opportunity but expect high volatility.';
  } else if (score >= 70) {
    bottomLine += 'Lower risk entry for those seeking stability.';
  } else {
    bottomLine += 'Proceed with caution and only risk what you can afford to lose.';
  }
  
  parts.push(bottomLine);
  
  return parts.join('');
}

function formatDuration(unlockTime) {
  if (!unlockTime) return "Permanent";
  const now = Math.floor(Date.now() / 1000);
  const diff = unlockTime - now;
  
  if (diff < 0) return "Already unlocked";
  
  const minutes = Math.floor(diff / 60);
  const hours = Math.floor(diff / 3600);
  const days = Math.floor(diff / 86400);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (hours < 1) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  
  if (days < 1) {
    const remainingMinutes = minutes - (hours * 60);
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  
  if (days < 14) {
    const remainingHours = hours - (days * 24);
    if (remainingHours > 0 && days < 7) {
      return `${days} ${days === 1 ? 'day' : 'days'} ${remainingHours}h`;
    }
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  
  if (days < 60) {
    const remainingDays = days - (weeks * 7);
    if (remainingDays > 0) {
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'}`;
    }
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  }
  
  if (days < 365) {
    const remainingDays = days - (months * 30);
    const remainingWeeks = Math.floor(remainingDays / 7);
    if (remainingWeeks > 0) {
      return `${months} ${months === 1 ? 'month' : 'months'} ${remainingWeeks} ${remainingWeeks === 1 ? 'week' : 'weeks'}`;
    }
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }
  
  const remainingDays = days - (years * 365);
  const remainingMonths = Math.floor(remainingDays / 30);
  
  if (remainingMonths >= 12) {
    const adjustedYears = years + Math.floor(remainingMonths / 12);
    const adjustedMonths = remainingMonths % 12;
    if (adjustedMonths > 0) {
      return `${adjustedYears} ${adjustedYears === 1 ? 'year' : 'years'} ${adjustedMonths} ${adjustedMonths === 1 ? 'month' : 'months'}`;
    }
    return `${adjustedYears} ${adjustedYears === 1 ? 'year' : 'years'}`;
  }
  
  if (remainingMonths > 0) {
    return `${years} ${years === 1 ? 'year' : 'years'} ${remainingMonths} ${remainingMonths === 1 ? 'month' : 'months'}`;
  }
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

function formatUnlockDate(unlockTime) {
  if (!unlockTime) return "Unknown";
  const date = new Date(unlockTime * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

async function getTokenCreationTime(tokenAddress, chainId) {
  try {
    const explorerApis = {
      1: `https://api.etherscan.io/api?module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      56: `https://api.bscscan.com/api?module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      137: `https://api.polygonscan.com/api?module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      8453: `https://api.basescan.org/api?module=account&action=txlist&address=${tokenAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`
    };
    
    const apiUrl = explorerApis[chainId];
    if (!apiUrl) return null;
    
    const response = await axios.get(apiUrl, { timeout: 5000 });
    
    if (response.data?.status === "1" && response.data?.result?.length > 0) {
      const firstTx = response.data.result[0];
      const creationTime = parseInt(firstTx.timeStamp);
      console.log(`✅ Token created at: ${new Date(creationTime * 1000).toISOString()}`);
      return creationTime;
    }
    
    return null;
  } catch (err) {
    console.log(`Token creation time fetch failed: ${err.message}`);
    return null;
  }
}

async function getWalletCreationTime(walletAddress, chainId) {
  try {
    const explorerApis = {
      1: `https://api.etherscan.io/api?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      56: `https://api.bscscan.com/api?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      137: `https://api.polygonscan.com/api?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`,
      8453: `https://api.basescan.org/api?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc`
    };
    
    const apiUrl = explorerApis[chainId];
    if (!apiUrl) return null;
    
    const response = await axios.get(apiUrl, { timeout: 5000 });
    
    if (response.data?.status === "1" && response.data?.result?.length > 0) {
      const firstTx = response.data.result[0];
      const creationTime = parseInt(firstTx.timeStamp);
      console.log(`✅ Wallet first tx at: ${new Date(creationTime * 1000).toISOString()}`);
      return creationTime;
    }
    
    return null;
  } catch (err) {
    console.log(`Wallet creation time fetch failed: ${err.message}`);
    return null;
  }
}

function formatContractAge(pairCreatedAt) {
  if (!pairCreatedAt) return null;
  
  const created = new Date(pairCreatedAt).getTime();
  const now = Date.now();
  const diffMs = now - created;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffDays < 1) {
    if (diffHours < 1) {
      return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'}`;
    }
    const remainingMinutes = diffMinutes - (diffHours * 60);
    return `${diffHours}h ${remainingMinutes}m`;
  }
  
  if (diffDays === 1) return "1 day";
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months`;
  return `${Math.floor(diffDays / 365)} years`;
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
    
    const { messageId, txHash, chainId, lockLog, eventName, source, explorerLink, chain, txData } = req.body;
    
    if (!messageId || !chainId || !lockLog) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // NEW: Detect lock fee if transaction data is available
    let lockFeeInfo = null;
    if (txData && lockLog.address) {
      lockFeeInfo = detectLockFee(txData, lockLog.address, chainId);
      if (lockFeeInfo) {
        console.log(`Lock fee: ${lockFeeInfo.paid ? `${lockFeeInfo.amount} native` : 'Whitelisted'}`);
      }
    }
    
    if (txHash && enrichmentCache.has(txHash)) {
      const cachedTime = enrichmentCache.get(txHash);
      const timeSince = Date.now() - cachedTime;
      
      if (timeSince < CACHE_TTL) {
        console.log(`⚠️ Duplicate enrichment request for ${txHash} (${Math.floor(timeSince / 1000)}s ago)`);
        return res.status(200).json({ status: "skipped", reason: "duplicate" });
      }
    }
    
    if (txHash) {
      enrichmentCache.set(txHash, Date.now());
      
      if (enrichmentCache.size > 100) {
        const now = Date.now();
        for (const [key, timestamp] of enrichmentCache.entries()) {
          if (now - timestamp > CACHE_TTL) {
            enrichmentCache.delete(key);
          }
        }
      }
    }
    
    const tokenData = extractTokenData(lockLog, eventName, source);
    console.log("Token extraction result:", JSON.stringify(tokenData, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));
    
    // NEW: Extract lock owner address
    const lockOwner = extractLockOwner(lockLog, eventName, source);
    if (lockOwner) {
      console.log(`Lock owner: ${lockOwner}`);
    }
    
    if (!tokenData.tokenAddress) {
      console.log("⚠️ Could not extract token address");
      await editTelegramMessage(messageId, `⚠️ Could not extract token address\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "no_token_address" });
    }
    
    // NEW: Check if this is an LP token (for Team Finance V2 onDeposit events)
    if (tokenData.needsLPCheck) {
      const lpCheck = await checkIfLPToken(tokenData.tokenAddress, chainId);
      if (lpCheck.isLP) {
        console.log(`✅ Detected LP token in onDeposit event`);
        tokenData.isLPLock = true;
        tokenData.tokenAddress = lpCheck.primaryToken;
        tokenData.token1 = lpCheck.pairedToken;
        tokenData.isPrimaryToken0 = lpCheck.isPrimaryToken0;
        tokenData.poolAddress = tokenData.tokenAddress; // Use original LP address as pool
      }
      delete tokenData.needsLPCheck;
    }
    
    // NEW: Query NFT position for Team Finance V3 NFT locks
    if (tokenData.needsNFTPositionQuery) {
      console.log(`Querying NFT position for token ID ${tokenData.tokenId}...`);
      const nftPosition = await queryNFTPosition(tokenData.tokenAddress, tokenData.tokenId, chainId);
      
      if (nftPosition) {
        console.log(`✅ NFT position queried successfully`);
        tokenData.tokenAddress = nftPosition.primaryToken;
        tokenData.token1 = nftPosition.pairedToken;
        tokenData.isPrimaryToken0 = nftPosition.isPrimaryToken0;
        tokenData.lpPosition = nftPosition.lpPosition;
        tokenData.poolAddress = nftPosition.poolAddress; // Use computed pool address
      } else {
        console.log(`⚠️ Could not query NFT position`);
      }
      
      delete tokenData.needsNFTPositionQuery;
      delete tokenData.tokenId;
    }
    
    const isNFTLock = eventName === "DepositNFT" && source === "Team Finance" && !tokenData.tokenAddress;
    
    if (isNFTLock) {
      console.log("⚠️ NFT Position lock detected - skipping for now");
      await editTelegramMessage(
        messageId, 
        `🔒 **NFT Position Lock Detected**\n\n` +
        `This is a Uniswap/PancakeSwap V3 LP position lock.\n\n` +
        `NFT Manager: \`${tokenData.tokenAddress.slice(0, 6)}...${tokenData.tokenAddress.slice(-4)}\`\n` +
        `Duration: ${formatDuration(tokenData.unlockTime)}\n` +
        `Source: ${source}\n` +
        `Chain: ${chain}\n\n` +
        `[View Transaction](${explorerLink})`
      );
      return res.status(200).json({ status: "skipped", reason: "nft_lock" });
    }
    
    const tokenInfo = await getTokenInfo(tokenData.tokenAddress, chainId);
    
    if (!tokenInfo) {
      console.log("⚠️ Could not fetch token info");
      await editTelegramMessage(messageId, `⚠️ Could not fetch token info\n\nToken: \`${tokenData.tokenAddress}\`\n\n[View Transaction](${explorerLink})`);
      return res.status(200).json({ status: "failed", reason: "rpc_failed" });
    }
    
    console.log(`Token info fetched: ${tokenInfo.symbol}`);
    
    let pairedTokenInfo = null;
    if (tokenData.isLPLock && tokenData.token1) {
      pairedTokenInfo = await getTokenInfo(tokenData.token1, chainId);
      if (pairedTokenInfo) {
        console.log(`Paired token info fetched: ${pairedTokenInfo.symbol}`);
      }
    }
    
    // NEW: Get pool state and calculate exact token amounts for LP locks
    let lpTokenAmounts = null;
    if (tokenData.isLPLock && tokenData.lpPosition && tokenData.poolAddress && pairedTokenInfo) {
      const poolState = await getPoolState(tokenData.poolAddress, chainId);
      if (poolState) {
        const decimals0 = tokenData.isPrimaryToken0 ? tokenInfo.decimals : pairedTokenInfo.decimals;
        const decimals1 = tokenData.isPrimaryToken0 ? pairedTokenInfo.decimals : tokenInfo.decimals;
        
        lpTokenAmounts = calculateTokenAmountsFromPosition(
          tokenData.lpPosition.liquidity.toString(),
          tokenData.lpPosition.tickLower,
          tokenData.lpPosition.tickUpper,
          poolState.tick,
          decimals0,
          decimals1
        );
        
        console.log(`✅ LP token amounts calculated: ${lpTokenAmounts.amount0} / ${lpTokenAmounts.amount1}`);
      }
    }
    
    const amount = tokenData.amount ? Number(tokenData.amount) / Math.pow(10, tokenInfo.decimals) : null;
    const duration = formatDuration(tokenData.unlockTime);
    const unlockDate = formatUnlockDate(tokenData.unlockTime);
    
    const enriched = await enrichTokenData(tokenData.tokenAddress, chainId);
    
    console.log(`Enrichment complete: price=${enriched.price}, liquidity=${enriched.liquidity}`);
    
    // Get token creation time for token age
    let tokenCreationTime = null;
    try {
      tokenCreationTime = await getTokenCreationTime(tokenData.tokenAddress, chainId);
    } catch (err) {
      console.error("Failed to get token creation time:", err.message);
    }
    
    // Get wallet creation time for wallet age
    let walletCreationTime = null;
    if (lockOwner) {
      try {
        walletCreationTime = await getWalletCreationTime(lockOwner, chainId);
      } catch (err) {
        console.error("Failed to get wallet creation time:", err.message);
      }
    }
    
    let nativePrice = null;
    try {
      nativePrice = await getNativeTokenPrice(chainId);
      console.log(`Native token price: ${nativePrice}`);
    } catch (err) {
      console.error("Failed to get native token price:", err.message);
    }
    
    const nativeSymbols = { 1: 'ETH', 56: 'BNB', 137: 'MATIC', 8453: 'ETH' };
    const nativeSymbol = nativeSymbols[chainId] || 'ETH';
    
    let lockedPercent = null;
    let usdValue = null;
    let primaryTokenAmount = null;
    let pairedTokenAmount = null;
    
    if (tokenData.isLPLock && lpTokenAmounts) {
      // Use calculated LP amounts
      primaryTokenAmount = tokenData.isPrimaryToken0 ? lpTokenAmounts.amount0 : lpTokenAmounts.amount1;
      pairedTokenAmount = tokenData.isPrimaryToken0 ? lpTokenAmounts.amount1 : lpTokenAmounts.amount0;
      
      // Calculate % of supply locked
      if (tokenInfo.totalSupply && primaryTokenAmount) {
        const totalSupply = Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals);
        const rawPercent = (primaryTokenAmount / totalSupply) * 100;
        lockedPercent = formatPercentage(rawPercent);
      }
      
      // Calculate USD value if we have price
      if (enriched.price && primaryTokenAmount) {
        usdValue = (primaryTokenAmount * enriched.price).toFixed(2);
      }
    } else if (amount && !tokenData.isLPLock) {
      // For regular token locks only (not LP tokens)
      if (tokenInfo.totalSupply) {
        const totalSupply = Number(tokenInfo.totalSupply) / Math.pow(10, tokenInfo.decimals);
        const rawPercent = (amount / totalSupply) * 100;
        lockedPercent = formatPercentage(rawPercent);
      }
      
      usdValue = enriched.price 
        ? (amount * enriched.price).toFixed(2)
        : null;
    } else if (amount && tokenData.isLPLock) {
      // For LP locks without calculated amounts, estimate USD value from locked liquidity
      // The 'amount' here is LP tokens, not project tokens
      if (enriched.liquidity) {
        // Rough estimate: assume locked LP tokens represent proportional liquidity
        usdValue = (enriched.liquidity * 0.5).toFixed(2); // Placeholder - would need better calculation
      }
    }
    
    // Build message with reordered sections
    const parts = [];
    
    // Header with padlock emoji for all lock types
    if (tokenData.isLPLock) {
      parts.push("🔒 **New LP lock detected**");
    } else {
      parts.push("🔒 **New token lock detected**");
    }
    
    parts.push("");
    
    // === CALCULATE SCORE AND GENERATE ANALYSIS ===
    const tokenAgeMinutes = tokenCreationTime ? (Date.now() - tokenCreationTime * 1000) / (1000 * 60) : null;
    const poolAgeMinutes = enriched.pairCreatedAt ? (Date.now() - new Date(enriched.pairCreatedAt).getTime()) / (1000 * 60) : null;
    
    // Prepare data for scoring
    const scoringData = {
      lockedPercent: lockedPercent,
      unlockTime: tokenData.unlockTime,
      nativeLocked: enriched.nativeTokenAmount || null,
      nativePrice: nativePrice,
      isVerified: enriched.securityData?.isOpenSource === true,
      isRenounced: enriched.securityData?.canTakeBackOwnership === false,
      isHoneypot: enriched.securityData?.isHoneypot === false,
      topHolderPercent: enriched.securityData?.topHolderPercent,
      holderCount: enriched.securityData?.holderCount,
      tokenAgeMinutes: tokenAgeMinutes,
      poolAgeMinutes: poolAgeMinutes,
      buysSells: enriched.txns24h,
      volume24h: enriched.volume24h,
      liquidity: enriched.liquidity,
      tokenSymbol: tokenInfo.symbol,
      isLPLock: tokenData.isLPLock,
      makers24h: enriched.makers24h
    };
    
    const { score } = calculateOpportunityScore(scoringData);
    const analysis = generateSmartAnalysis({ ...scoringData, score });
    
    // Extract just the bottom line from analysis
    const bottomLineMatch = analysis.match(/\*\*Bottom Line:\*\* (.+?)(?:\n|$)/);
    const bottomLine = bottomLineMatch ? bottomLineMatch[1] : 'Analysis pending';
    
    // Display simplified analysis
    let scoreRating = '';
    if (score >= 80) {
      scoreRating = 'Excellent';
    } else if (score >= 70) {
      scoreRating = 'Good';
    } else if (score >= 60) {
      scoreRating = 'Fair';
    } else if (score >= 50) {
      scoreRating = 'Moderate Risk';
    } else {
      scoreRating = 'High Risk';
    }
    
    parts.push(`🧠 **Analysis:** ${score}/100 (${scoreRating}). ${bottomLine}`);
    
    parts.push("");
    
    // 1. Token info
    parts.push("💎 **Token info**");
    parts.push(`Token: $${tokenInfo.symbol}`);
    
    // Show token age if available
    const tokenAge = tokenCreationTime ? formatContractAge(tokenCreationTime * 1000) : null;
    if (tokenAge) {
      parts.push(`Token Age: ${tokenAge}`);
    }
    
    // Show pool age if available
    const poolAge = formatContractAge(enriched.pairCreatedAt);
    if (poolAge) {
      parts.push(`Pool Age: ${poolAge}`);
    }
    
    if (enriched.price) {
      let priceStr;
      if (enriched.price >= 1) {
        priceStr = enriched.price.toFixed(enriched.price >= 100 ? 2 : 4);
      } else if (enriched.price >= 0.0001) {
        priceStr = enriched.price.toFixed(6).replace(/\.?0+$/, '');
      } else {
        priceStr = enriched.price.toFixed(8).replace(/\.?0+$/, '');
      }
      parts.push(`Price: $${priceStr}`);
      
      // Price changes - only show what makes sense based on pool age
      const poolAgeMs = enriched.pairCreatedAt ? (Date.now() - new Date(enriched.pairCreatedAt).getTime()) : null;
      const poolAgeMinutes = poolAgeMs ? poolAgeMs / (1000 * 60) : null;
      
      if (enriched.priceChange5m !== null || enriched.priceChange1h !== null || enriched.priceChange6h !== null) {
        const changes = [];
        
        // Always show 5m if available
        if (enriched.priceChange5m !== null) {
          const sign = enriched.priceChange5m >= 0 ? '+' : '';
          changes.push(`5m: ${sign}${enriched.priceChange5m.toFixed(1)}%`);
        }
        
        // Only show 1h if pool is older than 1 hour
        if (enriched.priceChange1h !== null && poolAgeMinutes && poolAgeMinutes >= 60) {
          const sign = enriched.priceChange1h >= 0 ? '+' : '';
          changes.push(`1h: ${sign}${enriched.priceChange1h.toFixed(1)}%`);
        }
        
        // Only show 6h if pool is older than 6 hours
        if (enriched.priceChange6h !== null && poolAgeMinutes && poolAgeMinutes >= 360) {
          const sign = enriched.priceChange6h >= 0 ? '+' : '';
          changes.push(`6h: ${sign}${enriched.priceChange6h.toFixed(1)}%`);
        }
        
        // Only show 24h if pool is older than 24 hours
        if (enriched.priceChange24h !== null && poolAgeMinutes && poolAgeMinutes >= 1440) {
          const sign = enriched.priceChange24h >= 0 ? '+' : '';
          changes.push(`24h: ${sign}${enriched.priceChange24h.toFixed(1)}%`);
        }
        
        if (changes.length > 0) {
          parts.push(changes.join(' | '));
        }
      }
    }
    
    if (enriched.marketCap) {
      const mcStr = enriched.marketCap >= 1000000 
        ? `$${(enriched.marketCap / 1000000).toFixed(1)}M`
        : enriched.marketCap >= 1000
        ? `$${(enriched.marketCap / 1000).toFixed(1)}K`
        : `$${enriched.marketCap.toFixed(0)}`;
      parts.push(`MC: ${mcStr}`);
    }
    
    if (enriched.pairName) {
      parts.push(`Pair: ${enriched.pairName}`);
    } else if (tokenData.isLPLock && pairedTokenInfo) {
      parts.push(`Pair: ${tokenInfo.symbol}/${pairedTokenInfo.symbol}`);
    }
    
    // Show pool liquidity in Token info for LP locks
    if (tokenData.isLPLock && enriched.liquidity) {
      const liqStr = enriched.liquidity >= 1000000
        ? `$${(enriched.liquidity / 1000000).toFixed(1)}M`
        : enriched.liquidity >= 1000
        ? `$${(enriched.liquidity / 1000).toFixed(1)}K`
        : `$${enriched.liquidity.toFixed(0)}`;
      parts.push(`Pool Liquidity: ${liqStr}`);
    }
    
    // Show native token amount in pool for LP locks
    if (tokenData.isLPLock && enriched.nativeTokenAmount && enriched.nativeTokenAmount > 0) {
      const nativeStr = enriched.nativeTokenAmount >= 1 
        ? enriched.nativeTokenAmount.toFixed(2)
        : enriched.nativeTokenAmount.toFixed(4);
      
      if (nativePrice) {
        const nativeUsdValue = (enriched.nativeTokenAmount * nativePrice).toFixed(2);
        parts.push(`Native in Pool: ${nativeStr} ${nativeSymbol} ($${Number(nativeUsdValue).toLocaleString()})`);
      } else {
        parts.push(`Native in Pool: ${nativeStr} ${nativeSymbol}`);
      }
    }
    
    // 2. Lock details
    parts.push("");
    parts.push("🔐 **Lock details**");
    
    // Show LP amounts if available
    if (primaryTokenAmount && pairedTokenInfo) {
      let primaryAmountStr;
      if (primaryTokenAmount >= 1000000) {
        primaryAmountStr = `${(primaryTokenAmount / 1000000).toFixed(2)}M`;
      } else if (primaryTokenAmount >= 1000) {
        primaryAmountStr = `${(primaryTokenAmount / 1000).toFixed(2)}K`;
      } else if (primaryTokenAmount >= 1) {
        primaryAmountStr = primaryTokenAmount.toFixed(2);
      } else {
        primaryAmountStr = primaryTokenAmount.toFixed(4);
      }
      
      let pairedAmountStr;
      if (pairedTokenAmount >= 1000000) {
        pairedAmountStr = `${(pairedTokenAmount / 1000000).toFixed(2)}M`;
      } else if (pairedTokenAmount >= 1000) {
        pairedAmountStr = `${(pairedTokenAmount / 1000).toFixed(2)}K`;
      } else if (pairedTokenAmount >= 1) {
        pairedAmountStr = pairedTokenAmount.toFixed(2);
      } else {
        pairedAmountStr = pairedTokenAmount.toFixed(4);
      }
      
      if (usdValue) {
        parts.push(`Amount: ${primaryAmountStr} ${tokenInfo.symbol} + ${pairedAmountStr} ${pairedTokenInfo.symbol} ($${Number(usdValue).toLocaleString()})`);
      } else {
        parts.push(`Amount: ${primaryAmountStr} ${tokenInfo.symbol} + ${pairedAmountStr} ${pairedTokenInfo.symbol}`);
      }
    } else if (amount) {
      let amountStr;
      if (amount >= 1000000) {
        amountStr = `${(amount / 1000000).toFixed(1)}M`;
      } else if (amount >= 1000) {
        amountStr = `${(amount / 1000).toFixed(1)}K`;
      } else if (amount >= 1) {
        amountStr = amount.toFixed(0);
      } else if (amount >= 0.01) {
        amountStr = amount.toFixed(2);
      } else {
        amountStr = amount.toFixed(4);
      }
      
      if (usdValue) {
        parts.push(`Amount: ${amountStr} tokens ($${Number(usdValue).toLocaleString()})`);
      } else {
        parts.push(`Amount: ${amountStr} tokens`);
      }
    }
    
    if (lockedPercent) {
      parts.push(`Locked: ${lockedPercent}% of supply`);
    }
    
    // Add LP lock as % of total liquidity
    let rawLiqPercent = null; // Declare outside so we can use it for native locked calculation
    if (tokenData.isLPLock && enriched.liquidity) {
      // If we have calculated USD value of locked position
      if (usdValue && parseFloat(usdValue) > 0) {
        rawLiqPercent = (parseFloat(usdValue) / enriched.liquidity) * 100;
      }
      // If we have native token locked, calculate based on that
      else if (enriched.nativeTokenAmount && enriched.nativeTokenAmount > 0 && nativePrice) {
        const lockedNativeUSD = enriched.nativeTokenAmount * nativePrice;
        const totalLiquidityNative = enriched.liquidity / 2; // Half of pool liquidity is native token
        if (totalLiquidityNative > 0) {
          rawLiqPercent = (lockedNativeUSD / totalLiquidityNative) * 100;
        }
      }
      
      if (rawLiqPercent !== null) {
        // Cap at 100% (can't lock more than 100% of the pool)
        rawLiqPercent = Math.min(rawLiqPercent, 100);
        const lockedLiqPercent = formatPercentage(rawLiqPercent);
        parts.push(`Locked Liquidity: ${lockedLiqPercent}% of pool`);
      }
    }
    
    // Show native token locked for LP locks (important metric that can't be manipulated)
    if (tokenData.isLPLock) {
      let actualNativeLocked = null;
      
      // Calculate actual native locked based on locked liquidity %
      if (enriched.nativeTokenAmount && enriched.nativeTokenAmount > 0 && rawLiqPercent) {
        actualNativeLocked = enriched.nativeTokenAmount * (rawLiqPercent / 100);
      }
      // Or use calculated paired token amounts for V3
      else if (pairedTokenAmount && pairedTokenInfo) {
        const wrappedNativeTokens = {
          1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',    // WETH
          56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',   // WBNB
          137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',  // WMATIC/WPOL
          8453: '0x4200000000000000000000000000000000000006'  // WETH on Base
        };
        
        const pairedTokenLower = tokenData.token1?.toLowerCase();
        const nativeTokenAddress = wrappedNativeTokens[chainId]?.toLowerCase();
        
        if (pairedTokenLower === nativeTokenAddress) {
          actualNativeLocked = pairedTokenAmount;
        }
      }
      
      // Display native locked if we have it
      if (actualNativeLocked && actualNativeLocked > 0) {
        const nativeStr = actualNativeLocked >= 1 
          ? actualNativeLocked.toFixed(2)
          : actualNativeLocked.toFixed(4);
        
        if (nativePrice) {
          const nativeUsdValue = (actualNativeLocked * nativePrice).toFixed(2);
          parts.push(`Native Locked: ${nativeStr} ${nativeSymbol} ($${Number(nativeUsdValue).toLocaleString()})`);
        } else {
          parts.push(`Native Locked: ${nativeStr} ${nativeSymbol}`);
        }
      }
    }
    
    parts.push(`Duration: ${duration}`);
    parts.push(`Platform: ${source}`);
    parts.push(`Chain: ${chain}`);
    
    // 3. Security section with emojis for owner holds
    parts.push("");
    parts.push("⚡ **Security**");
    
    if (enriched.buyTax !== null || enriched.sellTax !== null) {
      const buyTaxStr = enriched.buyTax !== null ? `${enriched.buyTax}%` : 'N/A';
      const sellTaxStr = enriched.sellTax !== null ? `${enriched.sellTax}%` : 'N/A';
      parts.push(`Tax: ${buyTaxStr} buy / ${sellTaxStr} sell`);
    }
    
    if (enriched.securityData?.ownerBalance !== undefined && enriched.securityData?.ownerBalance !== null) {
      const ownerPercent = enriched.securityData.ownerBalance;
      let ownerEmoji = '';
      
      // Add emoji based on owner holdings percentage
      if (ownerPercent === 0) {
        ownerEmoji = '✅';
      } else if (ownerPercent < 5) {
        ownerEmoji = '✅';
      } else if (ownerPercent < 10) {
        ownerEmoji = '⚠️';
      } else {
        ownerEmoji = '🔴';
      }
      
      parts.push(`${ownerEmoji} Owner holds: ${ownerPercent.toFixed(1)}%`);
    }
    
    // Add verification and honeypot checks
    if (enriched.securityData && Object.keys(enriched.securityData).length > 0) {
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
      
      // Contract renounced status
      if (enriched.securityData.canTakeBackOwnership === false) {
        parts.push("✅ Ownership renounced");
      } else if (enriched.securityData.canTakeBackOwnership === true) {
        parts.push("⚠️ Owner can take back control");
      }
    }
    
    // 4. Dev Wallet section
    if (lockOwner) {
      parts.push("");
      parts.push("👤 **Dev wallet**");
      
      // Add explorer link for wallet
      const explorerUrls = {
        1: 'https://etherscan.io/address/',
        56: 'https://bscscan.com/address/',
        137: 'https://polygonscan.com/address/',
        8453: 'https://basescan.org/address/'
      };
      const explorerUrl = explorerUrls[chainId];
      
      if (explorerUrl) {
        parts.push(`[${lockOwner.slice(0, 6)}...${lockOwner.slice(-4)}](${explorerUrl}${lockOwner})`);
      } else {
        parts.push(`\`${lockOwner.slice(0, 6)}...${lockOwner.slice(-4)}\``);
      }
      
      // Show wallet age
      const walletAge = walletCreationTime ? formatContractAge(walletCreationTime * 1000) : null;
      if (walletAge) {
        parts.push(`Wallet Age: ${walletAge}`);
      }
      
      // Show lock fee
      if (lockFeeInfo) {
        if (lockFeeInfo.paid) {
          const feeAmount = lockFeeInfo.amount.toFixed(4);
          let feeUSD = '';
          if (nativePrice) {
            const usdValue = (lockFeeInfo.amount * nativePrice).toFixed(2);
            feeUSD = ` ($${usdValue})`;
          }
          parts.push(`💰 Lock Fee: ${feeAmount} ${nativeSymbol}${feeUSD}`);
        } else if (lockFeeInfo.whitelisted) {
          parts.push(`💰 Lock Fee: Whitelisted`);
        }
      }
      
      // Note: Lock history requires querying lock platform APIs
      // For now, show placeholder that we can enhance later
      parts.push(`History: Not yet tracked`);
      
      // Token holdings would require indexer API (future enhancement)
      // parts.push(`Holds: X different tokens`);
    }
    
    // 5. Trading Stats section
    parts.push("");
    parts.push("📊 **Trading stats**");
    
    // Only show liquidity here for non-LP locks (for LP locks it's already in Token info)
    if (!tokenData.isLPLock && enriched.liquidity) {
      const liqStr = enriched.liquidity >= 1000000
        ? `$${(enriched.liquidity / 1000000).toFixed(1)}M`
        : enriched.liquidity >= 1000
        ? `$${(enriched.liquidity / 1000).toFixed(1)}K`
        : `$${enriched.liquidity.toFixed(0)}`;
      parts.push(`Liquidity: ${liqStr}`);
    }
    
    // Volume 24h
    if (enriched.volume24h) {
      const volStr = enriched.volume24h >= 1000000
        ? `$${(enriched.volume24h / 1000000).toFixed(1)}M`
        : enriched.volume24h >= 1000
        ? `$${(enriched.volume24h / 1000).toFixed(1)}K`
        : `$${enriched.volume24h.toFixed(0)}`;
      parts.push(`Volume 24h: ${volStr}`);
    }
    
    // Buy Volume 24h
    if (enriched.buyVolume24h) {
      const buyVolStr = enriched.buyVolume24h >= 1000000
        ? `$${(enriched.buyVolume24h / 1000000).toFixed(1)}M`
        : enriched.buyVolume24h >= 1000
        ? `$${(enriched.buyVolume24h / 1000).toFixed(1)}K`
        : `$${enriched.buyVolume24h.toFixed(0)}`;
      parts.push(`Buy Vol: ${buyVolStr}`);
    }
    
    // Sell Volume 24h
    if (enriched.sellVolume24h) {
      const sellVolStr = enriched.sellVolume24h >= 1000000
        ? `$${(enriched.sellVolume24h / 1000000).toFixed(1)}M`
        : enriched.sellVolume24h >= 1000
        ? `$${(enriched.sellVolume24h / 1000).toFixed(1)}K`
        : `$${enriched.sellVolume24h.toFixed(0)}`;
      parts.push(`Sell Vol: ${sellVolStr}`);
    }
    
    // Buys/Sells ratio
    if (enriched.txns24h) {
      const buys = enriched.txns24h.buys || 0;
      const sells = enriched.txns24h.sells || 0;
      if (buys > 0 || sells > 0) {
        let ratioText = '';
        if (sells > 0) {
          const ratio = buys / sells;
          if (ratio > 1) {
            ratioText = ` (${ratio.toFixed(1)}x more buys)`;
          } else if (ratio < 1) {
            const inverseRatio = sells / buys;
            ratioText = ` (${inverseRatio.toFixed(1)}x more sells)`;
          } else {
            ratioText = ' (equal)';
          }
        } else if (buys > 0) {
          ratioText = ' (only buys)';
        }
        parts.push(`Buys/Sells: ${buys.toLocaleString()}/${sells.toLocaleString()}${ratioText}`);
      }
    }
    
    // Makers (unique buyers/sellers)
    if (enriched.makers24h) {
      const buyers = enriched.makers24h.buyers || 0;
      const sellers = enriched.makers24h.sellers || 0;
      
      if (buyers > 0 || sellers > 0) {
        parts.push(`Makers: ${buyers.toLocaleString()} buyers / ${sellers.toLocaleString()} sellers`);
      }
    }
    
    if (enriched.totalTransactions) {
      const txStr = enriched.totalTransactions >= 1000000
        ? `${(enriched.totalTransactions / 1000000).toFixed(1)}M`
        : enriched.totalTransactions >= 1000
        ? `${(enriched.totalTransactions / 1000).toFixed(1)}K`
        : enriched.totalTransactions.toLocaleString();
      parts.push(`Total TXs: ${txStr}`);
    }
    
    // Holder count
    if (enriched.securityData?.holderCount) {
      parts.push(`Holders: ${enriched.securityData.holderCount.toLocaleString()}`);
    }
    
    // Top 10 holders percentage of supply - only show if > 0
    if (enriched.securityData?.topHolderPercent !== null && 
        enriched.securityData?.topHolderPercent !== undefined && 
        enriched.securityData.topHolderPercent > 0) {
      parts.push(`Top 10 Hold: ${enriched.securityData.topHolderPercent.toFixed(1)}% of supply`);
    }
    
    // Buy/Sell Tax
    if (enriched.buyTax !== null || enriched.sellTax !== null) {
      const buyTaxStr = enriched.buyTax !== null ? `${enriched.buyTax}%` : 'N/A';
      const sellTaxStr = enriched.sellTax !== null ? `${enriched.sellTax}%` : 'N/A';
      parts.push(`Tax: ${buyTaxStr} buy / ${sellTaxStr} sell`);
    }
    
    // Pattern warnings (if any)
    const patternWarnings = detectUnusualPatterns(
      lockedPercent ? parseFloat(lockedPercent) : null,
      tokenData.unlockTime,
      usdValue,
      tokenData.isLPLock
    );
    
    if (patternWarnings.length > 0) {
      parts.push("");
      parts.push("⚠️ **Warnings**");
      patternWarnings.forEach(warning => parts.push(warning));
    }
    
    // 6. Links
    parts.push("");
    parts.push("🔗 **Links**");
    
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    // All links on one line separated by |
    const links = [
      `[DexScreener](https://dexscreener.com/${chainName}/${tokenData.tokenAddress})`,
      `[DexTools](https://www.dextools.io/app/en/${chainName}/pair-explorer/${tokenData.tokenAddress})`,
      `[TokenSniffer](https://tokensniffer.com/token/${chainName}/${tokenData.tokenAddress})`
    ];
    parts.push(links.join(' | '));
    
    // Search on X - no line break
    const twitterSearchUrl = `https://twitter.com/search?q=${tokenData.tokenAddress}&src=typed_query&f=live`;
    parts.push(`[🔍 Search on X](${twitterSearchUrl})`);
    
    // 7. Snipe section with bot links and DEX
    parts.push("");
    parts.push("⚡ **Snipe**");
    
    // Generate bot links
    const unibotLink = `https://t.me/unibotsniper_bot?start=${tokenData.tokenAddress}`;
    const bananaLink = `https://t.me/BananaGunSniper_bot?start=snipe-${tokenData.tokenAddress}`;
    const maestroLink = `https://t.me/MaestroSniperBot?start=${tokenData.tokenAddress}`;
    
    // Bot links on one line
    const botLinks = [
      `[Unibot](${unibotLink})`,
      `[Banana Gun](${bananaLink})`,
      `[Maestro](${maestroLink})`
    ];
    parts.push(botLinks.join(' | '));
    
    // DEX buy link
    const buyLink = getBuyLink(tokenData.tokenAddress, chainId);
    const dexInfo = getDexInfo(chainId);
    if (buyLink && dexInfo) {
      parts.push(`[🛒 Buy on ${dexInfo.name}](${buyLink})`);
    } else if (buyLink) {
      parts.push(`[🛒 Buy Now](${buyLink})`);
    }
    
    // 8. View transaction
    parts.push("");
    parts.push(`[View Transaction](${explorerLink})`);
    
    const enrichedMessage = parts.join("\n");
    
    // Save enrichment data for performance tracking
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ 
        connectionString: process.env.POSTGRES_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });
      
      await pool.query(`
        UPDATE lock_alerts 
        SET 
          detection_price = $1,
          detection_mcap = $2,
          detection_liquidity = $3,
          lock_score = $4,
          locked_percent = $5,
          native_locked_usd = $6,
          token_symbol = $7,
          enriched_at = $8
        WHERE transaction_id = $9
      `, [
        enriched.price || null,
        enriched.marketCap || null,
        enriched.liquidity || null,
        score || null,
        lockedPercent ? parseFloat(lockedPercent) : null,
        (enriched.nativeTokenAmount && nativePrice) ? (enriched.nativeTokenAmount * nativePrice) : null,
        tokenInfo.symbol || null,
        Math.floor(Date.now() / 1000),
        req.body.txHash
      ]);
      
      await pool.end();
      console.log('✅ Saved enrichment data for performance tracking');
    } catch (dbErr) {
      console.error('⚠️ Failed to save enrichment data:', dbErr.message);
      // Don't fail the whole request if this fails
    }
    
    await editTelegramMessage(messageId, enrichedMessage);
    
    console.log("✅ Enrichment complete and message updated");
    
    return res.status(200).json({ status: "success" });
    
  } catch (err) {
    console.error("❌ Enrichment error:", err.message, err.stack);
    
    try {
      const { messageId, explorerLink, source, chain } = req.body;
      if (messageId && explorerLink) {
        await editTelegramMessage(
          messageId,
          `🔒 **New lock detected**\n\n` +
          `⚠️ Could not fetch token details\n\n` +
          `Platform: ${source || 'Unknown'}\n` +
          `Chain: ${chain || 'Unknown'}\n\n` +
          `[View Transaction](${explorerLink})`
        );
      }
    } catch (updateErr) {
      console.error("Failed to update message with error:", updateErr.message);
    }
    
    return res.status(500).json({ error: err.message });
  }
};
