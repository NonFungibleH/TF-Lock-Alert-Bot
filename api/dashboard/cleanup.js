const { Pool } = require('pg');

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
    
    const client = await pool.connect();
    
    // Delete price history older than 7 days
    const priceHistoryResult = await client.query(`
      DELETE FROM token_price_history
      WHERE timestamp_recorded < EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      RETURNING id;
    `);
    
    // Delete lock alerts older than 7 days
    const lockAlertsResult = await client.query(`
      DELETE FROM lock_alerts
      WHERE created_at < EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      RETURNING transaction_id;
    `);
    
    client.release();
    await pool.end();
    
    return res.status(200).json({
      status: 'cleaned',
      priceHistoryDeleted: priceHistoryResult.rowCount,
      lockAlertsDeleted: lockAlertsResult.rowCount,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    return res.status(500).json({ 
      error: 'Cleanup failed',
      details: error.message 
    });
  }
};
