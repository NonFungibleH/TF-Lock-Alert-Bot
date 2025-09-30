const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true });
    }
    
    const body = req.body || {};
    console.log('[DB Webhook] Received webhook call');
    
    // Skip validation pings
    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: 'Validation ping' });
    }
    
    // Use shared detection logic
    const lockResult = detectLock(body);
    
    if (!lockResult) {
      console.log('[DB Webhook] No lock detected');
      return res.status(200).json({ ok: true, note: 'No lock detected' });
    }
    
    const { chain, type, source, explorerLink, txHash } = lockResult;
    
    console.log(`[DB Webhook] Lock detected: ${txHash} on ${chain.name}`);
    
    // Save to database
    const db = new LockAlertDatabase();
    
    // Extract additional data from logs if available
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const lockLog = logs.find(l => l.transactionHash === txHash);
    
    const webhookData = {
      chain,
      type,
      source,
      explorerLink,
      txHash,
      contractAddress: lockLog?.address || null,
      eventName: lockResult.eventMap ? Object.values(lockResult.eventMap)[0]?.name : null,
      tokenAddress: null, // Will be enriched later
      tokenSymbol: null,  // Will be enriched later
      tokenAmount: null,  // Will be enriched later
      tokenPriceAtLock: null,
      usdValueAtLock: null
    };
    
    await db.addLockAlert(webhookData);
    
    console.log(`[DB Webhook] Saved to database: ${txHash}`);
    
    return res.status(200).json({ 
      status: 'saved',
      txHash,
      chain: chain.name,
      source,
      type
    });
    
  } catch (err) {
    console.error('[DB Webhook] Error:', err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
