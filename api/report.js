const axios = require("axios");
const { Pool } = require('pg');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// Fetch current price for a token
async function getCurrentPrice(tokenAddress, chainId) {
  try {
    const chainMap = { 1: "ethereum", 56: "bsc", 137: "polygon", 8453: "base" };
    const chainName = chainMap[chainId] || "ethereum";
    
    const url = `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data?.pairs && response.data.pairs.length > 0) {
      const chainPairs = response.data.pairs.filter(p => p.chainId === chainName);
      if (chainPairs.length > 0) {
        return parseFloat(chainPairs[0].priceUsd) || null;
      }
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
      const currentPrice = await getCurrentPrice(lock.token_address, lock.chain_id);
      
      if (currentPrice && lock.detection_price) {
        const priceChange = ((currentPrice - lock.detection_price) / lock.detection_price) * 100;
        
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
    
    // Sort by time (most recent first)
    const sorted = [...locksWithPerformance].sort((a, b) => b.created_at - a.created_at);
    
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
    
    // List all locks with performance
    sorted.forEach((lock, i) => {
      const changeEmoji = lock.price_change > 0 ? '🟢' : lock.price_change < 0 ? '🔴' : '⚪';
      const changeText = lock.price_change > 0 ? 'gain' : 'loss';
      const scoreStr = lock.lock_score ? ` | Score: ${lock.lock_score}/100` : '';
      
      lines.push(`${i + 1}. $${lock.token_symbol} ${changeEmoji}`);
      lines.push(`Alert: $${lock.detection_price.toFixed(8)}`);
      lines.push(`Live: $${lock.current_price.toFixed(8)}`);
      lines.push(`Performance: ${Math.abs(lock.price_change).toFixed(1)}% ${changeText}${scoreStr}`);
      lines.push('');
    });
    
    // Summary
    lines.push('📈 **Summary**');
    lines.push(`Total Locks: ${sorted.length}`);
    lines.push(`Profitable: ${profitable.length} (${profitRate}%)`);
    lines.push(`Avg Score of Winners: ${avgScoreWinners}/100`);
    lines.push(`Avg Score of Losers: ${avgScoreLosers}/100`);
    lines.push('');
    
    // Lock statistics from past 24 hours
    const locks24h = await pool.query(`
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
    
    if (locks24h.rows.length > 0) {
      const stats = locks24h.rows[0];
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
