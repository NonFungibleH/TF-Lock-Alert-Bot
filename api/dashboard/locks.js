const LockAlertDatabase = require('../../lib/database');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Optional query params
    const limit = parseInt(req.query.limit) || 100;
    const chain = req.query.chain; // Filter by chain name
    
    const db = new LockAlertDatabase();
    
    // Get locks from last 7 days
    let locks = await db.getAllLockAlerts(limit);
    
    // Filter by chain if specified
    if (chain) {
      locks = locks.filter(lock => lock.chain_name === chain);
    }
    
    // Get dashboard stats
    const stats = await db.getDashboardStats();
    
    // Get breakdown by platform and chain
    const platformBreakdown = locks.reduce((acc, lock) => {
      acc[lock.platform] = (acc[lock.platform] || 0) + 1;
      return acc;
    }, {});
    
    const chainBreakdown = locks.reduce((acc, lock) => {
      acc[lock.chain_name] = (acc[lock.chain_name] || 0) + 1;
      return acc;
    }, {});
    
    return res.status(200).json({
      locks,
      stats: {
        ...stats,
        platformBreakdown,
        chainBreakdown
      },
      meta: {
        count: locks.length,
        limit,
        timestamp: Date.now(),
        period: '7 days'
      }
    });
    
  } catch (error) {
    console.error('[Dashboard API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch locks',
      details: error.message 
    });
  }
};
