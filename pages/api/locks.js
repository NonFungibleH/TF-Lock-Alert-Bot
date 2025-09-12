// pages/api/locks.js

// In-memory storage - keeps only the last 20 locks
let locksData = []

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Return the most recent locks with enhanced price information
      const enrichedLocks = await enrichLocksWithPrices(locksData)
      // Sort by timestamp (newest first) and return only last 20
      const recentLocks = enrichedLocks
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20)
      
      res.status(200).json(recentLocks)
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
        // Extract token info if available, otherwise use mock data for now
        token1: extractTokenFromWebhookData(newLock) || generateTokenName(newLock.source),
        token2: 'USDT',
        usdValue: generateRealisticUSDValue(), 
        lockPrice: generateRealisticPrice(), 
        currentPrice: null // This will be updated by price API
      }
      
      // Add to beginning of array (newest first)
      locksData.unshift(enhancedLock)
      
      // Keep only the last 20 locks
      if (locksData.length > 20) {
        locksData = locksData.slice(0, 20)
      }
      
      console.log(`Lock added to dashboard (${locksData.length}/20):`, enhancedLock.txHash)
      res.status(201).json({ success: true, totalLocks: locksData.length })
    } catch (error) {
      console.error('Error adding lock:', error)
      res.status(500).json({ error: 'Failed to add lock' })
    }
  } else if (req.method === 'DELETE') {
    // Clear all locks (useful for testing)
    locksData = []
    console.log('All locks cleared')
    res.status(200).json({ success: true, message: 'All locks cleared' })
  } else {
    res.status(405).json({ error: 'Method not allowed' })
  }
}

// Try to extract token information from webhook data
function extractTokenFromWebhookData(lockData) {
  // Look for token info in the raw webhook data
  if (lockData.rawData && lockData.rawData.logs) {
    // This is where you could parse the actual token address/name from logs
    // For now, return null to use fallback
  }
  return null
}

// Generate realistic token names based on platform
function generateTokenName(source) {
  const tokensByPlatform = {
    'Team Finance': ['TEAM', 'FINX', 'LOCK', 'TFI'],
    'UNCX': ['UNCX', 'UNI', 'SWAP', 'DEX'],
    'GoPlus': ['GPL', 'SAFE', 'AUDIT', 'PLUS'],
    'PBTC': ['PBTC', 'BTC', 'WRAP', 'BASE']
  }
  
  const platformTokens = tokensByPlatform[source] || ['TOKEN', 'COIN', 'ASSET', 'CRYPTO']
  return platformTokens[Math.floor(Math.random() * platformTokens.length)]
}

// Generate realistic USD values based on typical lock amounts
function generateRealisticUSDValue() {
  const ranges = [
    { min: 5000, max: 50000, weight: 0.4 },      // Small locks
    { min: 50000, max: 500000, weight: 0.35 },   // Medium locks
    { min: 500000, max: 2000000, weight: 0.2 },  // Large locks
    { min: 2000000, max: 10000000, weight: 0.05 } // Whale locks
  ]
  
  const random = Math.random()
  let cumWeight = 0
  
  for (const range of ranges) {
    cumWeight += range.weight
    if (random <= cumWeight) {
      return Math.floor(Math.random() * (range.max - range.min) + range.min)
    }
  }
  
  return 100000 // fallback
}

// Generate realistic token prices
function generateRealisticPrice() {
  const priceTypes = [
    { min: 0.000001, max: 0.01, weight: 0.3 },   // Micro cap tokens
    { min: 0.01, max: 10, weight: 0.4 },         // Small cap tokens  
    { min: 10, max: 1000, weight: 0.25 },        // Mid cap tokens
    { min: 1000, max: 50000, weight: 0.05 }      // Large cap tokens
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
        // For other tokens, simulate realistic price movement
        const lockPrice = lock.lockPrice || generateRealisticPrice()
        const change = (Math.random() - 0.5) * 0.4 // ±20% change
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

// Fallback function for mock prices when API fails
function enrichWithMockPrices(locks) {
  return locks.map(lock => {
    if (!lock.currentPrice) {
      const lockPrice = lock.lockPrice || generateRealisticPrice()
      const change = (Math.random() - 0.5) * 0.4 // ±20% change
      lock.currentPrice = Math.max(0, lockPrice * (1 + change))
    }
    return lock
  })
}

// Clear sample data - start with empty array for real data only
// Remove this if you want to keep some sample data initially
console.log('Lock API initialized - waiting for webhook data (last 20 locks will be displayed)')
locksData = [] // Start with empty array
