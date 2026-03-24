// lib/onchain-analyzer.js
// Checks dev wallet reputation via three parallel sources:
//   1. honeypot.is + rugcheck.xyz (rug database check)
//   2. Moralis wallet first-tx timestamp (wallet age)
//   3. Hunt3r DB dev_wallets table (internal rug history)
// Always resolves — returns partial results on any failure.

const axios = require('axios');
const { Pool } = require('pg');

const TIMEOUT_MS = 6000;

async function checkRugDatabases(devWallet) {
  try {
    const [honeypotRes, rugcheckRes] = await Promise.allSettled([
      axios.get(`https://api.honeypot.is/v2/IsHoneypot?address=${devWallet}`, { timeout: TIMEOUT_MS }),
      axios.get(`https://api.rugcheck.xyz/v1/tokens/${devWallet}/report/summary`, { timeout: TIMEOUT_MS })
    ]);

    let flagged = false;

    if (honeypotRes.status === 'fulfilled') {
      const data = honeypotRes.value.data;
      if (data?.IsHoneypot === true || data?.honeypotResult?.isHoneypot === true) {
        flagged = true;
      }
    }

    if (rugcheckRes.status === 'fulfilled') {
      const data = rugcheckRes.value.data;
      // rugcheck returns a "risks" array — look for high-severity flags
      const risks = data?.risks || [];
      const highRisk = risks.some(r => r.level === 'danger' || r.level === 'high');
      if (highRisk) flagged = true;
    }

    return flagged;
  } catch {
    return false; // Optimistic on API failure
  }
}

async function getWalletAgeDays(devWallet, chainId) {
  if (!process.env.MORALIS_API_KEY) return null;

  try {
    const chainHex = '0x' + parseInt(chainId).toString(16);
    const response = await axios.get(
      `https://deep-index.moralis.io/api/v2.2/${devWallet}/transactions`,
      {
        params: { chain: chainHex, limit: 1, order: 'ASC' },
        headers: { 'X-API-Key': process.env.MORALIS_API_KEY },
        timeout: TIMEOUT_MS
      }
    );

    const firstTx = response.data?.result?.[0];
    if (!firstTx?.block_timestamp) return null;

    const firstTxDate = new Date(firstTx.block_timestamp);
    const ageDays = Math.floor((Date.now() - firstTxDate.getTime()) / (1000 * 60 * 60 * 24));
    return ageDays;
  } catch {
    return null;
  }
}

async function getHuntrDbReputation(devWallet) {
  if (!process.env.POSTGRES_URL) return { rugCount: 0, totalLocks: 0 };

  let pool;
  try {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    const result = await pool.query(
      'SELECT rug_count, total_locks FROM dev_wallets WHERE wallet_address = $1',
      [devWallet.toLowerCase()]
    );
    return {
      rugCount: result.rows[0]?.rug_count || 0,
      totalLocks: result.rows[0]?.total_locks || 0
    };
  } catch {
    return { rugCount: 0, totalLocks: 0 };
  } finally {
    if (pool) pool.end().catch(() => {});
  }
}

async function analyzeOnchain(devWallet, top3HolderPercent, chainId) {
  if (!devWallet) {
    return {
      devWalletFlagged: false,
      devWalletRugsInHuntrDb: 0,
      devWalletAgeDays: null,
      onchainScore: 0
    };
  }

  const [flagged, ageDays, reputation] = await Promise.allSettled([
    checkRugDatabases(devWallet),
    getWalletAgeDays(devWallet, chainId),
    getHuntrDbReputation(devWallet)
  ]);

  const devWalletFlagged = flagged.status === 'fulfilled' ? flagged.value : false;
  const devWalletAgeDays = ageDays.status === 'fulfilled' ? ageDays.value : null;
  const rugCount = reputation.status === 'fulfilled' ? reputation.value.rugCount : 0;

  let score = 0;
  if (!devWalletFlagged) score += 8;                         // not in rug DB
  if (rugCount === 0) score += 8;                            // no rugs in Hunt3r DB
  if (devWalletAgeDays != null && devWalletAgeDays > 90) score += 5; // wallet age
  if (top3HolderPercent != null && top3HolderPercent < 20) score += 4; // concentration

  console.log(`👤 On-chain score for ${devWallet.slice(0, 8)}: ${score}/25 (flagged=${devWalletFlagged}, age=${devWalletAgeDays}d, rugs=${rugCount})`);

  return {
    devWalletFlagged,
    devWalletRugsInHuntrDb: rugCount,
    devWalletAgeDays,
    onchainScore: score
  };
}

module.exports = { analyzeOnchain };
