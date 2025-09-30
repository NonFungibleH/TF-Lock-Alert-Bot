const { Pool } = require('pg');
const axios = require('axios');
const { decodeTokenAddress, getTokenMetadata } = require('../../lib/token-decoder');

// Price fetching for different chains
async function getTokenPrice(tokenAddress, chainId) {
  try {
    // Using DexScreener API (free, no key needed)
    const chainMap = {
      '1': 'ethereum',
      '56': 'bsc',
      '137': 'polygon',
      '8453': 'base'
    };
    
    const chain = chainMap[chainId];
    if (!chain) return null;
    
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: 5000 }
    );
    
    if (response.data?.pairs?.length > 0) {
      const pair = response.data.pairs[0];
      return {
        price: parseFloat(pair.priceUsd) || 0,
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        liquidity: parseFloat(pair.liquidity?.usd) || 0
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching price for ${tokenAddress}:`, error.message);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    // Auth check
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const expectedAuth = "Bearer " + process.env.ENRICHMENT_BEARER_TOKEN;
    
    if (!authHeader || authHeader !== expectedAuth) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Get locks from last 7 days
    const locksQuery = `
      SELECT transaction_id, chain_id, chain_name, platform, lock_type, 
             token_address, token_symbol, lock_timestamp, created_at
      FROM lock_alerts
      WHERE created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      ORDER BY created_at DESC
      LIMIT 50;
    `;
    
    const client = await pool.connect();
    const locksResult = await client.query(locksQuery);
    
    let enriched = 0;
    let decoded = 0;
    let errors = 0;
    
    for (const lock of locksResult.rows) {
      try {
        let tokenAddress = lock.token_address;
        let tokenSymbol = lock.token_symbol;
        
        // STEP 1: Decode token address if missing
        if (!tokenAddress) {
          console.log(`Decoding token for ${lock.transaction_id}...`);
          tokenAddress = await decodeTokenAddress(
            lock.transaction_id,
            lock.chain_id,
            lock.platform,
            lock.lock_type
          );
          
          if (tokenAddress) {
            // Get token metadata (symbol, decimals)
            const metadata = await getTokenMetadata(tokenAddress, lock.chain_id);
            tokenSymbol = metadata?.symbol || 'UNKNOWN';
            
            // Update database with token info
            await client.query(`
              UPDATE lock_alerts
              SET token_address = $1, token_symbol = $2
              WHERE transaction_id = $3;
            `, [tokenAddress, tokenSymbol, lock.transaction_id]);
            
            decoded++;
            console.log(`Decoded: ${tokenSymbol} at ${tokenAddress}`);
          } else {
            console.log(`Could not decode token for ${lock.transaction_id}`);
          }
        }
        
        // STEP 2: Fetch current price if we have token address
        if (tokenAddress) {
          const priceData = await getTokenPrice(tokenAddress, lock.chain_id);
          
          if (priceData) {
            // Update lock with current price
            await client.query(`
              UPDATE lock_alerts
              SET 
                current_token_price = $1,
                token_symbol = COALESCE(token_symbol, $2)
              WHERE transaction_id = $3;
            `, [priceData.price, priceData.symbol, lock.transaction_id]);
            
            // Calculate time since lock
            const currentTime = Math.floor(Date.now() / 1000);
            const timeSinceLock = Math.floor((currentTime - lock.lock_timestamp) / 60); // minutes
            
            // Store price history point
            const priceChangePercent = lock.token_price_at_lock 
              ? ((priceData.price - lock.token_price_at_lock) / lock.token_price_at_lock * 100)
              : null;
            
            await client.query(`
              INSERT INTO token_price_history 
              (transaction_id, token_address, token_symbol, price, timestamp_recorded, time_since_lock_minutes, price_change_percent)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT DO NOTHING;
            `, [
              lock.transaction_id,
              tokenAddress,
              priceData.symbol,
              priceData.price,
              currentTime,
              timeSinceLock,
              priceChangePercent
            ]);
            
            enriched++;
            console.log(`Enriched: ${priceData.symbol} = $${priceData.price}`);
          }
        }
        
        // Rate limiting - be nice to APIs
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`Error processing ${lock.transaction_id}:`, error.message);
        errors++;
      }
    }
    
    client.release();
    await pool.end();
    
    return res.status(200).json({
      status: 'completed',
      decoded,
      enriched,
      errors,
      total: locksResult.rows.length,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('[Enrichment] Error:', error);
    return res.status(500).json({ 
      error: 'Enrichment failed',
      details: error.message 
    });
  }
};
