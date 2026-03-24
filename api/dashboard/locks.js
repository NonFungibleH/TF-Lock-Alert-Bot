const { Pool } = require('pg');

const VALID_TIERS = ['opportunity', 'moderate', 'high-risk'];
const VALID_CHAINS = ['eth', 'bsc', 'polygon', 'base', 'matic'];

module.exports = async (req, res) => {
  const { tier, chain, limit: limitParam, offset: offsetParam } = req.query;

  // Validate params
  if (tier && !VALID_TIERS.includes(tier)) {
    return res.status(400).json({ error: 'Invalid parameter', message: `tier must be one of: ${VALID_TIERS.join(', ')}` });
  }
  if (chain && !VALID_CHAINS.includes(chain.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid parameter', message: `chain must be one of: ${VALID_CHAINS.join(', ')}` });
  }

  const limit = Math.min(Math.max(parseInt(limitParam) || 100, 1), 500);
  const offset = Math.max(parseInt(offsetParam) || 0, 0);

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    // Build filtered query
    const conditions = [];
    const queryParams = [];

    if (tier) {
      queryParams.push(tier);
      conditions.push(`tier = $${queryParams.length}`);
    }
    if (chain) {
      queryParams.push(chain.toLowerCase());
      conditions.push(`LOWER(chain_name) = $${queryParams.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Paginated locks query
    const dataParams = [...queryParams, limit, offset];
    const locksResult = await pool.query(`
      SELECT
        transaction_id,
        chain_name,
        source,
        token_symbol,
        token_address,
        detection_price,
        detection_mcap,
        detection_liquidity,
        lock_score,
        locked_percent,
        native_locked_usd,
        explorer_link,
        created_at,
        total_score,
        tier,
        social_score,
        onchain_score,
        market_score,
        twitter_handle,
        twitter_followers,
        sentiment,
        dev_wallet
      FROM lock_alerts
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `, dataParams);

    // Stats query (always full table, no filters)
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE tier = 'opportunity') AS opportunity,
        COUNT(*) FILTER (WHERE tier = 'moderate') AS moderate,
        COUNT(*) FILTER (WHERE tier = 'high-risk') AS high_risk
      FROM lock_alerts
    `);

    const chainsResult = await pool.query(`
      SELECT DISTINCT chain_name
      FROM lock_alerts
      WHERE chain_name IS NOT NULL
      ORDER BY chain_name ASC
    `);

    const s = statsResult.rows[0];
    const stats = {
      total: parseInt(s.total),
      opportunity: parseInt(s.opportunity),
      moderate: parseInt(s.moderate),
      highRisk: parseInt(s.high_risk),
      chains: chainsResult.rows.map(r => r.chain_name)
    };

    const locks = locksResult.rows.map(row => ({
      txHash: row.transaction_id,
      time: row.created_at,
      chain: row.chain_name,
      token: row.token_symbol || 'Unknown',
      tokenAddress: row.token_address,
      score: row.total_score,
      tier: row.tier,
      lockScore: row.lock_score,
      socialScore: row.social_score,
      onchainScore: row.onchain_score,
      marketScore: row.market_score,
      lockedPercent: row.locked_percent != null ? parseFloat(row.locked_percent) : null,
      nativeLockedUsd: row.native_locked_usd != null ? parseFloat(row.native_locked_usd) : null,
      marketCap: row.detection_mcap != null ? parseFloat(row.detection_mcap) : null,
      liquidity: row.detection_liquidity != null ? parseFloat(row.detection_liquidity) : null,
      price: row.detection_price != null ? parseFloat(row.detection_price) : null,
      twitterHandle: row.twitter_handle,
      twitterFollowers: row.twitter_followers,
      sentiment: row.sentiment,
      devWallet: row.dev_wallet,
      explorerLink: row.explorer_link,
      source: row.source
    }));

    res.json({ locks, stats });

  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  } finally {
    await pool.end();
  }
};
