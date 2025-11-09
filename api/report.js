const axios = require("axios");
const { Pool } = require('pg');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Fetch current price for a token
async function getCurrentPrice(tokenAddress, chainId) {
  if (!tokenAddress) {
    console.log('⚠️ Token address is null, skipping price fetch');
    return null;
  }
  
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    const url = `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data?.pairs && response.data.pairs.length > 0) {
      // Filter to correct chain AND exact token address match
      const chainPairs = response.data.pairs.filter(p => {
        const matchesChain = p.chainId === chainName;
        // Check if our token is either baseToken or quoteToken in the pair
        const baseTokenMatch = p.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase();
        const quoteTokenMatch = p.quoteToken?.address?.toLowerCase() === tokenAddress.toLowerCase();
        return matchesChain && (baseTokenMatch || quoteTokenMatch);
      });
      
      if (chainPairs.length > 0) {
        // Sort by liquidity (highest first) to get most accurate price
        const sortedByLiquidity = chainPairs.sort((a, b) => {
          const liqA = parseFloat(a.liquidity?.usd || 0);
          const liqB = parseFloat(b.liquidity?.usd || 0);
          return liqB - liqA;
        });
        
        const bestPair = sortedByLiquidity[0];
        
        // DexScreener's priceUsd is ALWAYS the price of baseToken in USD
        // We need to figure out which token is ours and get the right price
        let price;
        if (bestPair.baseToken?.address?.toLowerCase() === tokenAddress.toLowerCase()) {
          // Our token is the base token, use priceUsd directly
          price = parseFloat(bestPair.priceUsd);
        } else {
          // Our token is the quote token
          // Need to get our token's price from priceNative or calculate it
          // For quote token: if base/quote pair, and we want quote price,
          // we need to know the quote token (usually WETH, WBNB, etc) price in USD
          // But DexScreener doesn't give us quote token price directly
          // Best option: use priceNative if quote is a known stable/native token
          
          // For now, skip pairs where our token is quote token as we can't reliably get price
          console.log(`⚠️ Token ${tokenAddress.slice(0,8)}... is quote token in pair, skipping`);
          return null;
        }
        
        console.log(`Price for ${tokenAddress.slice(0,8)}...: $${price} (liq: $${bestPair.liquidity?.usd || 0})`);
        
        // Handle very small numbers that might be displayed incorrectly
        if (price && !isNaN(price) && price > 0) {
          return price;
        }
      }
      
      console.log(`⚠️ No matching pairs found for ${tokenAddress.slice(0,8)}... on ${chainName}`);
    }
    return null;
  } catch (err) {
    console.error(`Failed to get price for ${tokenAddress}:`, err.message);
    return null;
  }
}

// Format percentage change with color emoji
function formatChange(change) {
  if (change === null) return 'N/A';
  const emoji = change > 0 ? '🟢' : change < 0 ? '🔴' : '⚪';
  const sign = change > 0 ? '+' : '';
  return `${emoji} ${sign}${change.toFixed(1)}%`;
}

// Generate performance report
async function generateReport(hoursBack = 72) {
  const pool = new Pool({ 
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  try {
    // Get locks from past X hours that have enrichment data
    const result = await pool.query(`
      SELECT 
        token_address,
        token_symbol,
        chain_id,
        detection_price,
        detection_mcap,
        lock_score,
        locked_percent,
        native_locked_usd,
        created_at,
        transaction_id
      FROM lock_alerts
      WHERE 
        created_at >= EXTRACT(EPOCH FROM NOW()) - $1
        AND detection_price IS NOT NULL
        AND token_symbol IS NOT NULL
        AND token_address IS NOT NULL
      ORDER BY created_at DESC
    `, [hoursBack * 3600]);
    
    const locks = result.rows;
    console.log(`📊 Found ${locks.length} locks in past ${hoursBack} hours`);
    
    if (locks.length === 0) {
      return `📊 **Lock Performance Report**\n\nNo locks detected in the past ${hoursBack} hours.`;
    }
    
    // Fetch current prices
    const locksWithPerformance = [];
    
    for (const lock of locks) {
      // Skip if token address is null
      if (!lock.token_address) {
        console.log(`⚠️ Skipping lock ${lock.transaction_id.slice(0,8)}... - no token address`);
        continue;
      }
      
      const currentPrice = await getCurrentPrice(lock.token_address, lock.chain_id);
      
      if (currentPrice && lock.detection_price) {
        const detectionPrice = parseFloat(lock.detection_price);
        const priceChange = ((currentPrice - detectionPrice) / detectionPrice) * 100;
        
        // Sanity check: If price change is > 1,000,000% or price drops to near zero, likely bad data
        if (Math.abs(priceChange) > 1000000) {
          console.log(`⚠️ Suspicious price for ${lock.token_symbol}: detection=$${detectionPrice}, current=$${currentPrice}, change=${priceChange.toFixed(0)}%`);
        }
        
        locksWithPerformance.push({
          ...lock,
          current_price: currentPrice,
          price_change: priceChange,
          hours_ago: Math.floor((Date.now() / 1000 - lock.created_at) / 3600)
        });
      }
      
      // Rate limit - wait 200ms between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`✅ Got prices for ${locksWithPerformance.length}/${locks.length} locks`);
    
    if (locksWithPerformance.length === 0) {
      return `📊 **Lock Performance Report**\n\nFound ${locks.length} locks but couldn't fetch current prices.`;
    }
    
    // Sort by performance (best to worst)
    const sorted = [...locksWithPerformance].sort((a, b) => b.price_change - a.price_change);
    
    // Split into 24h and 24-72h
    const locks24h = sorted.filter(l => l.hours_ago < 24);
    const locks2472h = sorted.filter(l => l.hours_ago >= 24);
    
    // Calculate stats
    const profitable = sorted.filter(l => l.price_change > 0);
    const unprofitable = sorted.filter(l => l.price_change <= 0);
    const profitRate = (profitable.length / sorted.length * 100).toFixed(0);
    
    const avgScoreWinners = profitable.length > 0
      ? (profitable.reduce((sum, l) => sum + (l.lock_score || 0), 0) / profitable.length).toFixed(0)
      : 'N/A';
    
    const avgScoreLosers = unprofitable.length > 0
      ? (unprofitable.reduce((sum, l) => sum + (l.lock_score || 0), 0) / unprofitable.length).toFixed(0)
      : 'N/A';
    
    // Build report
    const lines = [];
    lines.push(`📊 **Lock Performance Report**`);
    lines.push(`${new Date().toLocaleDateString()} | Past ${hoursBack}h`);
    lines.push('');
    
    // Section 1: Past 24 hours
    if (locks24h.length > 0) {
      lines.push('⏰ **Past 24 Hours**');
      lines.push('');
      
      locks24h.forEach((lock, i) => {
        const changeEmoji = lock.price_change > 0 ? '🟢' : lock.price_change < 0 ? '🔴' : '⚪';
        const sign = lock.price_change > 0 ? '+' : '';
        const priceChange = parseFloat(lock.price_change);
        const scoreStr = lock.lock_score ? ` (${lock.lock_score}/100)` : '';
        
        lines.push(`${i + 1}. $${lock.token_symbol} ${changeEmoji} ${sign}${priceChange.toFixed(1)}%${scoreStr}`);
      });
      
      lines.push('');
    }
    
    // Section 2: 24-72 hours
    if (locks2472h.length > 0) {
      lines.push('📅 **24-72 Hours Ago**');
      lines.push('');
      
      locks2472h.forEach((lock, i) => {
        const changeEmoji = lock.price_change > 0 ? '🟢' : lock.price_change < 0 ? '🔴' : '⚪';
        const sign = lock.price_change > 0 ? '+' : '';
        const priceChange = parseFloat(lock.price_change);
        const scoreStr = lock.lock_score ? ` (${lock.lock_score}/100)` : '';
        
        lines.push(`${i + 1}. $${lock.token_symbol} ${changeEmoji} ${sign}${priceChange.toFixed(1)}%${scoreStr}`);
      });
      
      lines.push('');
    }
    
    // Summary
    lines.push('📈 **Summary**');
    lines.push(`Total Locks: ${sorted.length}`);
    lines.push(`Profitable: ${profitable.length} (${profitRate}%)`);
    lines.push(`Avg Score of Winners: ${avgScoreWinners}/100`);
    lines.push(`Avg Score of Losers: ${avgScoreLosers}/100`);
    lines.push('');
    
    // Lock statistics from past 24 hours
    const locks24hStats = await pool.query(`
      SELECT 
        COUNT(*) as total_locks,
        COUNT(*) FILTER (WHERE platform = 'Team Finance') as team_finance,
        COUNT(*) FILTER (WHERE platform = 'UNCX') as uncx,
        COUNT(*) FILTER (WHERE chain_id = '1') as ethereum,
        COUNT(*) FILTER (WHERE chain_id = '56') as bnb,
        COUNT(*) FILTER (WHERE chain_id = '8453') as base,
        COUNT(*) FILTER (WHERE chain_id = '137') as polygon
      FROM lock_alerts
      WHERE created_at >= EXTRACT(EPOCH FROM NOW()) - 86400
    `);
    
    if (locks24hStats.rows.length > 0) {
      const stats = locks24hStats.rows[0];
      const totalLocks24h = parseInt(stats.total_locks) || 0;
      const tfCount = parseInt(stats.team_finance) || 0;
      const uncxCount = parseInt(stats.uncx) || 0;
      const ethCount = parseInt(stats.ethereum) || 0;
      const bnbCount = parseInt(stats.bnb) || 0;
      const baseCount = parseInt(stats.base) || 0;
      const polygonCount = parseInt(stats.polygon) || 0;
      
      lines.push('🔒 **Lock Stats (Past 24h)**');
      lines.push(`Total Created: ${totalLocks24h}`);
      lines.push(`Share: ${tfCount} TF / ${uncxCount} UNCX`);
      
      const chains = [];
      if (ethCount > 0) chains.push(`Ethereum: ${ethCount}`);
      if (bnbCount > 0) chains.push(`BNB: ${bnbCount}`);
      if (baseCount > 0) chains.push(`Base: ${baseCount}`);
      if (polygonCount > 0) chains.push(`Polygon: ${polygonCount}`);
      
      if (chains.length > 0) {
        lines.push(chains.join(' | '));
      }
    }
    
    return lines.join('\n');
    
  } catch (err) {
    console.error('Report generation error:', err);
    return `❌ Error generating report: ${err.message}`;
  } finally {
    await pool.end();
  }
}

// API Handler
module.exports = async (req, res) => {
  try {
    console.log('📊 Report requested');
    
    const hoursBack = parseInt(req.query.hours) || 72;
    const report = await generateReport(hoursBack);
    
    // Send to Telegram
    const chatId = req.query.chatId || process.env.TELEGRAM_GROUP_CHAT_ID;
    
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: report,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }
    );
    
    console.log('✅ Report sent to Telegram');
    
    return res.status(200).json({ 
      status: 'success',
      message: 'Report sent to Telegram'
    });
    
  } catch (err) {
    console.error('Report handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
