const axios = require('axios');

// RPC endpoints for each chain
const RPC_URLS = {
  '1': process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
  '56': process.env.BSC_RPC || 'https://bsc-dataseed.binance.org',
  '137': process.env.POLYGON_RPC || 'https://polygon-rpc.com',
  '8453': process.env.BASE_RPC || 'https://mainnet.base.org'
};

// Platform-specific token address extraction
const TOKEN_EXTRACTORS = {
  'Team Finance': extractTeamFinanceToken,
  'UNCX': extractUNCXToken,
  'GoPlus': extractGoPlusToken,
  'PBTC': extractPBTCToken
};

async function fetchTransactionReceipt(txHash, chainId) {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chain ${chainId}`);
  }
  
  try {
    const response = await axios.post(rpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_getTransactionReceipt',
      params: [txHash],
      id: 1
    }, { timeout: 10000 });
    
    return response.data.result;
  } catch (error) {
    console.error(`Failed to fetch receipt for ${txHash}:`, error.message);
    return null;
  }
}

function extractTeamFinanceToken(receipt, lockType) {
  // Team Finance logs structure:
  // V2 Deposit: token is in topics[1]
  // V3 onLock/DepositNFT: token is in topics[2]
  
  const lockLog = receipt.logs.find(log => 
    log.topics[0] === '0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c' || // onLock
    log.topics[0] === '0x69963d4b9cdadfa6aee5e588b147db4212209aa72fd9b3c7f655e20cd7efa762'    // DepositNFT
  );
  
  if (!lockLog) return null;
  
  // Token address is usually in topics[2] for V3, topics[1] for V2
  const tokenTopic = lockType.includes('V3') ? lockLog.topics[2] : lockLog.topics[1];
  if (!tokenTopic) return null;
  
  // Convert topic to address (remove leading zeros)
  return '0x' + tokenTopic.slice(-40);
}

function extractUNCXToken(receipt, lockType) {
  // UNCX logs structure:
  // onDeposit event: token address in topics[1]
  
  const lockLog = receipt.logs.find(log => 
    log.topics[0] === '0x3bf9c85fbe37d401523942f10940796acef64062e1a1c45647978e32f4969f5c' // onDeposit
  );
  
  if (!lockLog || !lockLog.topics[1]) return null;
  
  return '0x' + lockLog.topics[1].slice(-40);
}

function extractGoPlusToken(receipt, lockType) {
  // GoPlus logs structure:
  // TokenLocked or Transfer events
  // Token address varies by version
  
  const lockLog = receipt.logs.find(log => 
    log.topics[0] === '0x84b0481c1600515c2ca5bf787b1ee44cfafc7c24906e9b54bb42e7de9c6c2c17' || // TokenLocked
    log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'    // Transfer (NFT)
  );
  
  if (!lockLog) return null;
  
  // For V3/V4 NFT-based locks, need to decode the data field
  // For V2, token is in topics
  if (lockLog.topics.length > 1) {
    return '0x' + lockLog.topics[1].slice(-40);
  }
  
  return null;
}

function extractPBTCToken(receipt, lockType) {
  // PBTC creates tokens via Adshares factory
  // Look for TokenCreated event from factory
  
  const TOKEN_CREATED_TOPIC = '0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3';
  
  const createdLog = receipt.logs.find(log => 
    log.topics[0] === TOKEN_CREATED_TOPIC
  );
  
  if (!createdLog || !createdLog.topics[1]) return null;
  
  return '0x' + createdLog.topics[1].slice(-40);
}

async function decodeTokenAddress(txHash, chainId, platform, lockType) {
  try {
    console.log(`Decoding token for tx ${txHash}, platform: ${platform}`);
    
    // Fetch transaction receipt
    const receipt = await fetchTransactionReceipt(txHash, chainId);
    if (!receipt || !receipt.logs) {
      console.log('No receipt or logs found');
      return null;
    }
    
    // Get the appropriate extractor for this platform
    const extractor = TOKEN_EXTRACTORS[platform] || TOKEN_EXTRACTORS[platform.split(' ')[0]];
    if (!extractor) {
      console.log(`No extractor found for platform: ${platform}`);
      return null;
    }
    
    // Extract token address
    const tokenAddress = extractor(receipt, lockType);
    
    if (tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000') {
      console.log(`Decoded token address: ${tokenAddress}`);
      return tokenAddress.toLowerCase();
    }
    
    console.log('No valid token address found');
    return null;
    
  } catch (error) {
    console.error(`Error decoding token for ${txHash}:`, error.message);
    return null;
  }
}

// Fetch token metadata (symbol, decimals) from blockchain
async function getTokenMetadata(tokenAddress, chainId) {
  try {
    const rpcUrl = RPC_URLS[chainId];
    if (!rpcUrl) return null;
    
    // ERC20 symbol() function signature
    const symbolData = '0x95d89b41';
    // ERC20 decimals() function signature  
    const decimalsData = '0x313ce567';
    
    const [symbolResponse, decimalsResponse] = await Promise.all([
      axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: tokenAddress,
          data: symbolData
        }, 'latest'],
        id: 1
      }, { timeout: 5000 }),
      axios.post(rpcUrl, {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: tokenAddress,
          data: decimalsData
        }, 'latest'],
        id: 2
      }, { timeout: 5000 })
    ]);
    
    // Decode symbol (skip first 64 chars for offset, next 64 for length, then data)
    let symbol = 'UNKNOWN';
    if (symbolResponse.data.result && symbolResponse.data.result !== '0x') {
      const hex = symbolResponse.data.result.slice(130); // Skip offset and length
      symbol = Buffer.from(hex, 'hex').toString('utf8').replace(/\0/g, '');
    }
    
    // Decode decimals
    let decimals = 18;
    if (decimalsResponse.data.result && decimalsResponse.data.result !== '0x') {
      decimals = parseInt(decimalsResponse.data.result, 16);
    }
    
    return { symbol, decimals };
    
  } catch (error) {
    console.error(`Error fetching token metadata for ${tokenAddress}:`, error.message);
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

module.exports = {
  decodeTokenAddress,
  getTokenMetadata
};
