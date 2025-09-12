// pages/api/locks.js

// In-memory storage for demo - in production, use a database
let locksData = []

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Return stored locks data with enhanced information
      const enrichedLocks = await enrichLocksWithPrices(locksData)
      res.status(200).json(enrichedLocks)
    } catch (error) {
      console.error('Error serving locks:', error)
      res.status(500).json({ error: 'Failed to fetch locks' })
    }
  } else if (req.method === 'POST') {
    try {
      // Add new lock data (called from your webhook)
      const newLock = req.body
      
      // Enhance the lock data with additional fields needed for the dashboard
      const enhancedLock = {
        ...newLock,
        id: Date.now(),
        timestamp: new Date().toISOString(),
        // Add mock data for fields not provided by webhook
        token1: extractToken1(newLock.source, newLock.type) || 'TOKEN',
        token2: 'USDT',
        usdValue: generateMockUSDValue(), 
        lockPrice: generateMockPrice(), 
        currentPrice: null // This will be updated by price API
      }
      
      // Add to in-memory storage (limit to last 100 locks)
      locksData.unshift(enhancedLock) // Add to beginning for newest first
      if (locksData.length > 100) {
        locksData = locksData.slice(0, 100)
      }
      
      console.log('Lock added to dashboard:', enhancedLock.txHash)
      res.status(201).json({ success: true })
    } catch (error) {
      console.error('Error adding lock:', error)
      res.status(500).json({ error: 'Failed to add lock' })
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}

// Helper function to extract token name from source/type
function extractToken1(source, type) {
  // Generate realistic token names based on source
  const tokens = {
    'Team Finance': ['TF', 'TEAM', 'FINX', 'LOCK'],
    'UNCX': ['UNCX', 'UNI', 'SWAP', 'DEX'],
    'GoPlus': ['GPL', 'SAFE', 'AUDIT', 'PLUS'],
    'PBTC': ['PBTC', 'BTC', 'WRAP', 'BASE']
  }
  
  const sourceTokens = tokens[source] || ['TOKEN', 'COIN', 'ASSET', 'CRYPTO']
  return sourceTokens[Math.floor(Math.random() * sourceTokens.length)]
}

// Generate realistic USD values
function generateMockUSDValue() {
  const ranges = [
    { min: 1000, max: 10000, weight: 0.3 },
    { min: 10000, max: 100000, weight: 0.4 },
    { min: 100000, max: 1000000, weight: 0.25 },
    { min: 1000000, max: 10000000, weight: 0.05 }
  ]
  
  const random = Math.random()
  let cumWeight = 0
  
  for (const range of ranges) {
    cumWeight += range.weight
    if (random <= cumWeight) {
      return Math.floor(Math.random() * (range.max - range.min) + range.min)
    }
  }
  
  return 50000 // fallback
}

// Generate realistic token prices
function generateMockPrice() {
  const priceTypes = [
    { min: 0.000001, max: 0.001, weight: 0.3 }, // micro tokens
    { min: 0.001, max: 1, weight: 0.4 },        // small tokens  
    { min: 1, max: 100, weight: 0.25 },         // medium tokens
    { min: 100, max: 10000, weight: 0.05 }      // large tokens
  ]
  
  const random = Math.random()
  let cumWeight = 0
  
  for (const priceType of priceTypes) {
    cumWeight += priceType.weight
    if (random <= cumWeight) {
      return Math.random() * (priceType.max - priceType.min) + priceType.min
    }
  }
  
  return 1 // fallback
}

// Function to enrich locks with current price data
async function enrichLocksWithPrices(locks) {
  try {
    // Get current prices from CoinGecko (free tier)
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,binancecoin,matic-network&vs_currencies=usd',
      { 
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        }
      }
    )
    
    if (!response.ok) {
      console.warn('CoinGecko API request failed, using mock prices')
      return enrichWithMockPrices(locks)
    }
    
    const prices = await response.json()
    
    return locks.map(lock => {
      let currentPrice = lock.currentPrice || lock.lockPrice
      
      // Update current price based on token mapping
      if (lock.token1?.toLowerCase().includes('eth')) {
        currentPrice = prices.ethereum?.usd || currentPrice
      } else if (lock.token1?.toLowerCase().includes('btc')) {
        currentPrice = prices.bitcoin?.usd || currentPrice
      } else if (lock.token1?.toLowerCase().includes('bnb')) {
        currentPrice = prices.binancecoin?.usd || currentPrice
      } else if (lock.token1?.toLowerCase().includes('matic')) {
        currentPrice = prices['matic-network']?.usd || currentPrice
      } else {
        // For other tokens, simulate price movement
        const lockPrice = lock.lockPrice || generateMockPrice()
        const change = (Math.random() - 0.5) * 0.3 // ±15% change
        currentPrice = lockPrice * (1 + change)
      }
      
      return {
        ...lock,
        currentPrice: Math.max(0, currentPrice) // Ensure non-negative
      }
    })
  } catch (error) {
    console.error('Error enriching with prices:', error)
    return enrichWithMockPrices(locks)
  }
}

// Fallback function for mock prices
function enrichWithMockPrices(locks) {
  return locks.map(lock => {
    if (!lock.currentPrice) {
      const lockPrice = lock.lockPrice || generateMockPrice()
      const change = (Math.random() - 0.5) * 0.3 // ±15% change
      lock.currentPrice = Math.max(0, lockPrice * (1 + change))
    }
    return lock
  })
}

// Add some sample data if empty (for testing)
if (locksData.length === 0) {
  const sampleLocks = [
    {
      id: 1,
      chain: { name: 'Ethereum', explorer: 'https://etherscan.io/tx/' },
      type: 'V3 Token',
      source: 'Team Finance',
      txHash: '0x1234567890abcdef1234567890abcdef12345678',
      explorerLink: 'https://etherscan.io/tx/0x1234567890abcdef1234567890abcdef12345678',
      token1: 'TEAM',
      token2: 'USDT',
      usdValue: 125000,
      lockPrice: 2.45,
      currentPrice: 2.67,
      timestamp: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
    },
    {
      id: 2,
      chain: { name: 'BNB Chain', explorer: 'https://bscscan.com/tx/' },
      type: 'V4 Token',
      source: 'UNCX',
      txHash: '0xabcdef1234567890abcdef1234567890abcdef12',
      explorerLink: 'https://bscscan.com/tx/0xabcdef1234567890abcdef1234567890abcdef12',
      token1: 'UNCX',
      token2: 'USDT',
      usdValue: 89000,
      lockPrice: 0.045,
      currentPrice: 0.042,
      timestamp: new Date(Date.now() - 7200000).toISOString() // 2 hours ago
    },
    {
      id: 3,
      chain: { name: 'Base', explorer: 'https://basescan.org/tx/' },
      type: 'V3 Token',
      source: 'PBTC',
      txHash: '0x567890abcdef1234567890abcdef1234567890ab',
      explorerLink: 'https://basescan.org/tx/0x567890abcdef1234567890abcdef1234567890ab',
      token1: 'PBTC',
      token2: 'USDT',
      usdValue: 340000,
      lockPrice: 15.20,
      currentPrice: 16.85,
      timestamp: new Date(Date.now() - 10800000).toISOString() // 3 hours ago
    }
  ]
  
  locksData = sampleLocks
}
