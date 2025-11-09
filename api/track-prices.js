const axios = require("axios");
const { Pool } = require('pg');

// Fetch current price for a token
async function getCurrentPrice(tokenAddress, chainId) {
  if (!tokenAddress) return null;
  
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    const url = `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data?.pairs && response.data.pairs.length > 0) {
      // Filter to correct chain AND exact token address match
      const chainPairs = response.data.pairs.filter(p => {
        const matchesChain = p.chainId === chainName;
        const baseTokenMatch = p.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase();
        const quoteTokenMatch = p.quoteToken?.address?.toLowerCase() === tokenAddress.toLowerCase();
        return matchesChain && (baseTokenMatch || quoteTokenMatch);
      });
      
      if (chainPairs.length > 0) {
        // Sort by liquidity (highest first)
        const sortedByLiquidity = chainPairs.sort((a, b) => {
          const liqA = parseFloat(a.liquidity?.usd || 0);
          const liqB = parseFloat(b.liquidity?.usd || 0);
          return liqB - liqA;
        });
        
        const bestPair = sortedByLiquidity[0];
        
        // Only use price if our token is the base token
        if (bestPair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()) {
          return {
            price: parseFloat(bestPair.priceUsd) || null,
            marketCap: parseFloat(bestPair.fdv) || null,
            liquidity: parseFloat(bestPair.liquidity?.usd) || null,
            volume24h: parseFloat(bestPair.volume?.h24) || null
          };
        }
      }
    }
    return null;
  } catch (err) {
    console.error(`Failed to get price for ${tokenAddress}:`, err.message);
    return null;
  }
}

// Track prices for all active locks
async function trackPrices() {
  const pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  try {
    console.log('⏰ Starting hourly price tracking...');
    
    // Get all locks from past 72 hours that have token addresses
    const result = await pool.query(`
      SELECT 
        transaction_id,
        token_address,
        chain_id,
        created_at
      FROM lock_alerts
      WHERE 
        created_at >= EXTRACT(EPOCH FROM NOW()) - 259200
        AND token_address IS NOT NULL
      ORDER BY created_at DESC
    `);
    
    const locks = result.rows;
    console.log(`📊 Found ${locks.length} locks to track`);
    
    if (locks.length === 0) {
      return { tracked: 0, message: 'No locks to track' };
    }
    
    let tracked = 0;
    let skipped = 0;
    
    for (const lock of locks) {
      // Calculate hours since lock
      const hoursAfterLock = Math.floor((Date.now() / 1000 - lock.created_at) / 3600);
      
      // Only track up to 72 hours
      if (hoursAfterLock > 72) {
        skipped++;
        continue;
      }
      
      // Check if we already have a snapshot for this hour
      const existing = await pool.query(`
        SELECT id FROM token_price_snapshots
        WHERE transaction_id = $1 AND hours_after_lock = $2
      `, [lock.transaction_id, hoursAfterLock]);
      
      if (existing.rows.length > 0) {
        skipped++;
        continue; // Already tracked this hour
      }
      
      // Fetch current price data
      const priceData = await getCurrentPrice(lock.token_address, lock.chain_id);
      
      if (priceData) {
        // Save snapshot
        await pool.query(`
          INSERT INTO token_price_snapshots (
            transaction_id,
            token_address,
            chain_id,
            hours_after_lock,
            price,
            market_cap,
            liquidity,
            volume_24h
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (transaction_id, hours_after_lock) DO NOTHING
        `, [
          lock.transaction_id,
          lock.token_address,
          lock.chain_id,
          hoursAfterLock,
          priceData.price,
          priceData.marketCap,
          priceData.liquidity,
          priceData.volume24h
        ]);
        
        tracked++;
        console.log(`✅ Tracked ${lock.token_address.slice(0,8)}... at ${hoursAfterLock}h`);
      } else {
        skipped++;
      }
      
      // Rate limit - wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`✅ Tracking complete: ${tracked} snapshots saved, ${skipped} skipped`);
    
    return {
      tracked,
      skipped,
      total: locks.length,
      message: `Successfully tracked ${tracked} price snapshots`
    };
    
  } catch (err) {
    console.error('❌ Price tracking error:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

// API Handler
module.exports = async (req, res) => {
  try {
    const result = await trackPrices();
    
    return res.status(200).json({ 
      status: 'success',
      ...result
    });
    
  } catch (err) {
    console.error('Track prices handler error:', err);
    return res.status(500).json({ 
      status: 'error',
      error: err.message 
    });
  }
};
