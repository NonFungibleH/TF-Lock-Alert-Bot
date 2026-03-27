const { Pool } = require('pg');

const VALID_TIERS = ['opportunity', 'moderate', 'high-risk'];
const VALID_CHAINS = ['eth', 'bsc', 'polygon', 'base', 'matic'];

module.exports = async (req, res) => {
  const { tier, chain, limit: limitParam, offset: offsetParam, from, to } = req.query;

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

  // Ensure V2 columns exist (idempotent migrations)
  try {
    const migrationClient = await pool.connect();
    const v2Cols = [
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS total_score INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS tier VARCHAR(20)`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS lock_score INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS social_score INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS onchain_score INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS market_score INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(255)`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS twitter_followers INTEGER`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20)`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS dev_wallet VARCHAR(255)`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS locked_percent DECIMAL`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS native_locked_usd DECIMAL`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS detection_price DECIMAL`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS detection_mcap DECIMAL`,
      `ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS detection_liquidity DECIMAL`,
    ];
    for (const sql of v2Cols) {
      await migrationClient.query(sql);
    }
    migrationClient.release();
  } catch (migErr) {
    console.warn('Migration warning (non-fatal):', migErr.message);
  }

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

    if (from) {
      const fromEpoch = Math.floor(new Date(from).getTime() / 1000);
      if (!isNaN(fromEpoch)) {
        queryParams.push(fromEpoch);
        conditions.push(`created_at >= $${queryParams.length}`);
      }
    }

    if (to) {
      const toEpoch = Math.floor(new Date(to).getTime() / 1000);
      if (!isNaN(toEpoch)) {
        queryParams.push(toEpoch);
        conditions.push(`created_at <= $${queryParams.length}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Paginated locks query
    const dataParams = [...queryParams, limit, offset];
    const locksResult = await pool.query(`
      SELECT
        transaction_id,
        chain_name,
        token_symbol,
        token_address,
        token_price_at_lock,
        usd_value_at_lock,
        detection_mcap,
        detection_liquidity,
        lock_score,
        locked_percent,
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
      nativeLockedUsd: row.usd_value_at_lock != null ? parseFloat(row.usd_value_at_lock) : null,
      marketCap: row.detection_mcap != null ? parseFloat(row.detection_mcap) : null,
      liquidity: row.detection_liquidity != null ? parseFloat(row.detection_liquidity) : null,
      price: row.token_price_at_lock != null ? parseFloat(row.token_price_at_lock) : null,
      twitterHandle: row.twitter_handle,
      twitterFollowers: row.twitter_followers,
      sentiment: row.sentiment,
      devWallet: row.dev_wallet,
      explorerLink: row.explorer_link,
    }));

    res.json({ locks, stats });

  } catch (err) {
    console.error('Dashboard API error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  } finally {
    await pool.end();
  }
};
