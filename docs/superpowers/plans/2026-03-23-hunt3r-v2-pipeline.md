# Hunt3r.exe V2 Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Hunt3r.exe into a modular scoring pipeline that classifies every lock 0–100, routes alerts to tiered Telegram channels, and saves enriched scoring data to Postgres.

**Architecture:** Five new focused lib modules handle discrete concerns (social scoring, on-chain analysis, score computation, message formatting, Telegram routing). `api/enrich-lock.js` becomes a thin orchestrator that builds a shared context object, calls each module in parallel where possible, then sequences scoring → formatting → routing → DB save. `webhook.js` and `lib/database.js` get targeted updates only.

**Tech Stack:** Node.js, twitter-api-v2, openai (already installed), axios, pg, Jest (to be added as devDependency)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `lib/social-scorer.js` | Twitter/X search + OpenAI sentiment → socialScore |
| Create | `lib/onchain-analyzer.js` | Rug DB + Moralis wallet age + Hunt3r DB → onchainScore |
| Create | `lib/scoring-engine.js` | Lock Quality + Market & Safety sub-scores + hard disqualifiers → totalScore + tier |
| Create | `lib/alert-formatter.js` | Build tiered Telegram message string from context object |
| Create | `lib/alert-router.js` | Edit #all-locks message; send to #opportunities if score 61+ |
| Create | `tests/scoring-engine.test.js` | Jest unit tests for pure scoring logic |
| Create | `tests/alert-formatter.test.js` | Jest unit tests for message building |
| Modify | `lib/database.js` | Add V2 columns to initializeDatabase(); add upsertScores() method |
| Modify | `api/webhook.js` | Use TELEGRAM_TOPIC_ALL_LOCKS env var (rename from TELEGRAM_TOPIC_DISCUSSION) |
| Modify | `api/enrich-lock.js` | Add social + onchain enrichment to parallel Promise.allSettled; replace calculateOpportunityScore + message build with module calls |
| Modify | `package.json` | Add jest as devDependency; add test script |

---

## Task 1: Add Jest and run first passing test

**Files:**
- Modify: `package.json`
- Create: `tests/scoring-engine.test.js` (stub)

- [ ] **Step 1.1: Add Jest to package.json**

Edit `package.json` — add to `"devDependencies"`:
```json
"jest": "^29.7.0"
```
And add to `"scripts"`:
```json
"test": "jest"
```

- [ ] **Step 1.2: Install**

```bash
cd /Users/howardpearce/Projects/TF-Lock-Alert-Bot
npm install
```
Expected: `jest@29.x.x` added to `node_modules`.

- [ ] **Step 1.3: Create stub test to confirm Jest works**

Create `tests/scoring-engine.test.js`:
```javascript
describe('scoring-engine (stub)', () => {
  test('placeholder passes', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 1.4: Run test**

```bash
npx jest tests/scoring-engine.test.js --no-coverage
```
Expected output: `PASS tests/scoring-engine.test.js` — 1 test passing.

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json tests/scoring-engine.test.js
git commit -m "feat: add jest test runner"
```

---

## Task 2: DB schema migration

**Files:**
- Modify: `lib/database.js`

- [ ] **Step 2.1: Add V2 column migrations to `initializeDatabase()`**

In `lib/database.js`, inside the `initializeDatabase()` method, after the existing `CREATE INDEX` statements and before `client.release()`, add:

```javascript
// V2 scoring columns
await client.query(`
    ALTER TABLE lock_alerts
    ADD COLUMN IF NOT EXISTS social_score INTEGER,
    ADD COLUMN IF NOT EXISTS onchain_score INTEGER,
    ADD COLUMN IF NOT EXISTS lock_score INTEGER,
    ADD COLUMN IF NOT EXISTS market_score INTEGER,
    ADD COLUMN IF NOT EXISTS total_score INTEGER,
    ADD COLUMN IF NOT EXISTS tier VARCHAR(20),
    ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(100),
    ADD COLUMN IF NOT EXISTS twitter_followers INTEGER,
    ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20),
    ADD COLUMN IF NOT EXISTS dev_wallet VARCHAR(255),
    ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);
`);

// Dev wallet reputation table
await client.query(`
    CREATE TABLE IF NOT EXISTS dev_wallets (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(255) UNIQUE NOT NULL,
        first_seen_at BIGINT NOT NULL,
        total_locks INTEGER DEFAULT 0,
        rug_count INTEGER DEFAULT 0,
        last_updated BIGINT
    );
`);

await client.query(`
    CREATE INDEX IF NOT EXISTS idx_dev_wallets_address ON dev_wallets(wallet_address);
`);
await client.query(`
    CREATE INDEX IF NOT EXISTS idx_lock_alerts_tier ON lock_alerts(tier);
`);
```

- [ ] **Step 2.2: Add `upsertScores()` method to `LockAlertDatabase`**

Add this method to the class, before `close()`:

```javascript
async upsertScores(txHash, scores) {
    try {
        const {
            lockScore, socialScore, onchainScore, marketScore,
            totalScore, tier,
            twitterHandle, twitterFollowers, sentiment,
            devWallet, tokenPriceAtLock, usdValueAtLock,
            tokenAddress, tokenSymbol
        } = scores;

        await this.pool.query(`
            UPDATE lock_alerts SET
                lock_score = $1,
                social_score = $2,
                onchain_score = $3,
                market_score = $4,
                total_score = $5,
                tier = $6,
                twitter_handle = $7,
                twitter_followers = $8,
                sentiment = $9,
                dev_wallet = $10,
                token_price_at_lock = COALESCE(token_price_at_lock, $11),
                usd_value_at_lock = COALESCE(usd_value_at_lock, $12),
                token_address = COALESCE(token_address, $13),
                token_symbol = COALESCE(token_symbol, $14),
                outcome = COALESCE(outcome, 'unknown')
            WHERE transaction_id = $15
        `, [
            lockScore, socialScore, onchainScore, marketScore,
            totalScore, tier,
            twitterHandle || null, twitterFollowers || null, sentiment || null,
            devWallet || null,
            tokenPriceAtLock || null, usdValueAtLock || null,
            tokenAddress || null, tokenSymbol || null,
            txHash
        ]);

        // Upsert dev_wallets record
        if (devWallet) {
            await this.pool.query(`
                INSERT INTO dev_wallets (wallet_address, first_seen_at, total_locks, last_updated)
                VALUES ($1, $2, 1, $2)
                ON CONFLICT (wallet_address) DO UPDATE SET
                    total_locks = dev_wallets.total_locks + 1,
                    last_updated = $2
            `, [devWallet, Math.floor(Date.now() / 1000)]);
        }

        console.log(`✅ Scores saved: ${txHash} → ${totalScore}/100 (${tier})`);
    } catch (err) {
        console.error('❌ upsertScores failed:', err.message);
        // Don't rethrow — DB save failure must never kill the pipeline
    }
}
```

- [ ] **Step 2.3: Verify no syntax errors**

```bash
node -e "const db = require('./lib/database'); console.log('OK');" 2>&1 | head -5
```
Expected: `OK` (Postgres connection will fail without env vars — that's fine, we just want no syntax errors).

- [ ] **Step 2.4: Commit**

```bash
git add lib/database.js
git commit -m "feat: add V2 schema migrations and upsertScores method"
```

---

## Task 3: lib/scoring-engine.js — TDD

**Files:**
- Create: `lib/scoring-engine.js`
- Modify: `tests/scoring-engine.test.js`

The scoring engine is a pure function — no I/O, easy to TDD fully.

- [ ] **Step 3.1: Write the full failing test suite**

Replace `tests/scoring-engine.test.js`:

```javascript
const { computeScore } = require('../lib/scoring-engine');

// Minimal valid context — all scores available
function ctx(overrides = {}) {
  return {
    lockDurationDays: 365,
    lockedPercent: 75,
    nativeLockedUsd: 10000,
    socialScore: 20,
    onchainScore: 21,
    isHoneypot: false,
    contractVerified: true,
    ownershipRenounced: true,
    holderCount: 150,
    buySellRatio: 2.5,
    devWalletFlagged: false,
    ...overrides
  };
}

describe('computeScore — Lock Quality sub-score', () => {
  test('duration >= 1 year → 10 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 365 }));
    // 10 (duration) + 8 (≥75% locked) + 7 (≥$10K) = 25
    expect(lockScore).toBe(25);
  });

  test('duration 6–12 months → 7 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 200 }));
    // 7 + 8 + 7 = 22
    expect(lockScore).toBe(22);
  });

  test('duration 1–6 months → 4 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 60 }));
    // 4 + 8 + 7 = 19
    expect(lockScore).toBe(19);
  });

  test('duration < 1 month → 0 pts on duration', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 20 }));
    // 0 + 8 + 7 = 15
    expect(lockScore).toBe(15);
  });

  test('50–74% locked → 5 pts', () => {
    const { lockScore } = computeScore(ctx({ lockedPercent: 60 }));
    // 10 + 5 + 7 = 22
    expect(lockScore).toBe(22);
  });

  test('nativeLockedUsd $1K–$10K → 4 pts', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: 5000 }));
    // 10 + 8 + 4 = 22
    expect(lockScore).toBe(22);
  });

  test('nativeLockedUsd < $1K → 0 pts', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: 500 }));
    // 10 + 8 + 0 = 18
    expect(lockScore).toBe(18);
  });
});

describe('computeScore — Market & Safety sub-score', () => {
  test('all 5 signals true → 25 pts', () => {
    const { marketScore } = computeScore(ctx());
    expect(marketScore).toBe(25);
  });

  test('honeypot = true → 0 on honeypot signal', () => {
    const { marketScore } = computeScore(ctx({ isHoneypot: true }));
    // 5 (verified) + 0 (honeypot) + 5 (renounced) + 5 (holders) + 5 (buy/sell) = 20
    expect(marketScore).toBe(20);
  });

  test('holderCount <= 100 → 0 on holder signal', () => {
    const { marketScore } = computeScore(ctx({ holderCount: 50 }));
    // 5 + 5 + 5 + 0 + 5 = 20
    expect(marketScore).toBe(20);
  });

  test('buySellRatio <= 2 → 0 on ratio signal', () => {
    const { marketScore } = computeScore(ctx({ buySellRatio: 1.5 }));
    // 5 + 5 + 5 + 5 + 0 = 20
    expect(marketScore).toBe(20);
  });
});

describe('computeScore — total score and tier', () => {
  test('high-quality lock → Opportunity tier', () => {
    const { totalScore, tier } = computeScore(ctx({ socialScore: 20, onchainScore: 21 }));
    // lockScore=25 + social=20 + onchain=21 + market=25 = 91
    expect(totalScore).toBe(91);
    expect(tier).toBe('opportunity');
  });

  test('score 31–60 → Moderate tier', () => {
    const { totalScore, tier } = computeScore(ctx({
      lockDurationDays: 20, lockedPercent: 10, nativeLockedUsd: 500,
      socialScore: 5, onchainScore: 5,
      holderCount: 50, buySellRatio: 1.0
    }));
    expect(totalScore).toBeGreaterThanOrEqual(31);
    expect(totalScore).toBeLessThanOrEqual(60);
    expect(tier).toBe('moderate');
  });

  test('score 0–30 → High Risk tier', () => {
    const { totalScore, tier } = computeScore(ctx({
      lockDurationDays: 10, lockedPercent: 5, nativeLockedUsd: 200,
      socialScore: 0, onchainScore: 0,
      contractVerified: false, ownershipRenounced: false,
      holderCount: 10, buySellRatio: 0.5
    }));
    expect(totalScore).toBeLessThanOrEqual(30);
    expect(tier).toBe('high-risk');
  });
});

describe('computeScore — hard disqualifiers', () => {
  test('devWalletFlagged → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ devWalletFlagged: true }));
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('isHoneypot → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ isHoneypot: true, devWalletFlagged: false }));
    // Note: honeypot = hard disqualifier
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('lockDurationDays < 7 → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ lockDurationDays: 5 }));
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('disqualified alert still returns sub-scores for display', () => {
    const result = computeScore(ctx({ devWalletFlagged: true }));
    // Sub-scores computed before disqualification, stored separately for transparency
    expect(result.lockScore).toBeGreaterThan(0);
    expect(result.disqualifierReason).toBeDefined();
  });
});

describe('computeScore — null/missing data graceful handling', () => {
  test('null lockedPercent → 0 pts on lock % signal', () => {
    const { lockScore } = computeScore(ctx({ lockedPercent: null }));
    // 10 + 0 + 7 = 17
    expect(lockScore).toBe(17);
  });

  test('null nativeLockedUsd → 0 pts on USD signal', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: null }));
    // 10 + 8 + 0 = 18
    expect(lockScore).toBe(18);
  });

  test('null holderCount → 0 pts on holder signal', () => {
    const { marketScore } = computeScore(ctx({ holderCount: null }));
    // 5 + 5 + 5 + 0 + 5 = 20
    expect(marketScore).toBe(20);
  });
});
```

- [ ] **Step 3.2: Run tests — confirm all fail**

```bash
npx jest tests/scoring-engine.test.js --no-coverage 2>&1 | tail -5
```
Expected: `Cannot find module '../lib/scoring-engine'`

- [ ] **Step 3.3: Implement `lib/scoring-engine.js`**

Create `lib/scoring-engine.js`:

```javascript
// lib/scoring-engine.js
// Pure function — no I/O, no side effects.
// Input: shared context object from the enrichment pipeline
// Output: { lockScore, marketScore, totalScore, tier, disqualifierReason }

function computeLockScore(ctx) {
  let score = 0;
  const { lockDurationDays, lockedPercent, nativeLockedUsd } = ctx;

  // Duration (0–10 pts)
  if (lockDurationDays >= 365) score += 10;
  else if (lockDurationDays >= 180) score += 7;
  else if (lockDurationDays >= 30) score += 4;
  // < 30 days → 0 pts

  // % of LP token supply locked (0–8 pts)
  if (lockedPercent != null) {
    if (lockedPercent >= 75) score += 8;
    else if (lockedPercent >= 50) score += 5;
    else if (lockedPercent >= 25) score += 3;
  }

  // Native USD value locked (0–7 pts)
  if (nativeLockedUsd != null) {
    if (nativeLockedUsd >= 10000) score += 7;
    else if (nativeLockedUsd >= 1000) score += 4;
  }

  return score;
}

function computeMarketScore(ctx) {
  let score = 0;
  const {
    contractVerified, isHoneypot, ownershipRenounced,
    holderCount, buySellRatio
  } = ctx;

  if (contractVerified === true) score += 5;
  if (isHoneypot === false) score += 5;
  if (ownershipRenounced === true) score += 5;
  if (holderCount != null && holderCount > 100) score += 5;
  if (buySellRatio != null && buySellRatio > 2) score += 5;

  return score;
}

function computeScore(ctx) {
  const lockScore = computeLockScore(ctx);
  const socialScore = ctx.socialScore ?? 0;
  const onchainScore = ctx.onchainScore ?? 0;
  const marketScore = computeMarketScore(ctx);

  const rawTotal = lockScore + socialScore + onchainScore + marketScore;

  // Hard disqualifiers
  let disqualifierReason = null;
  if (ctx.devWalletFlagged === true) {
    disqualifierReason = 'Dev wallet flagged in rug database';
  } else if (ctx.isHoneypot === true) {
    disqualifierReason = 'Token confirmed as honeypot';
  } else if (ctx.lockDurationDays < 7) {
    disqualifierReason = 'Lock duration under 7 days';
  }

  const totalScore = disqualifierReason !== null ? 0 : rawTotal;

  let tier;
  if (totalScore >= 61) tier = 'opportunity';
  else if (totalScore >= 31) tier = 'moderate';
  else tier = 'high-risk';

  return { lockScore, socialScore, onchainScore, marketScore, totalScore, tier, disqualifierReason };
}

module.exports = { computeScore };
```

- [ ] **Step 3.4: Run tests — confirm all pass**

```bash
npx jest tests/scoring-engine.test.js --no-coverage
```
Expected: `PASS tests/scoring-engine.test.js` — all tests green.

- [ ] **Step 3.5: Commit**

```bash
git add lib/scoring-engine.js tests/scoring-engine.test.js
git commit -m "feat: add scoring-engine with full test coverage"
```

---

## Task 4: lib/alert-formatter.js — TDD

**Files:**
- Create: `lib/alert-formatter.js`
- Create: `tests/alert-formatter.test.js`

- [ ] **Step 4.1: Write failing tests**

Create `tests/alert-formatter.test.js`:

```javascript
const { formatAlert } = require('../lib/alert-formatter');

function opportunityCtx(overrides = {}) {
  return {
    tier: 'opportunity',
    totalScore: 74,
    lockScore: 18,
    socialScore: 20,
    onchainScore: 18,
    marketScore: 18,
    chain: 'BNB Chain',
    source: 'UNCX',
    tokenSymbol: 'PEPE',
    price: 0.0012,
    priceChange1h: 7.6,
    marketCap: 3500,
    liquidity: 2400,
    lockDurationDays: 365,
    lockedPercent: 75,
    nativeLockedUsd: 1200,
    nativeSymbol: 'BNB',
    contractVerified: true,
    isHoneypot: false,
    ownershipRenounced: true,
    ownerHoldPercent: 0,
    devWallet: '0xabc123',
    devWalletAgeDays: 142,
    devWalletFlagged: false,
    devWalletRugsInHuntrDb: 0,
    volume24h: 240,
    buySellRatio: 2.7,
    holderCount: 42,
    twitterHandle: '@TokenHandle',
    twitterFollowers: 4200,
    twitterActiveLast7Days: true,
    twitterSentiment: 'Positive',
    explorerLink: 'https://bscscan.com/tx/0x123',
    disqualifierReason: null,
    ...overrides
  };
}

describe('formatAlert — opportunity tier', () => {
  test('includes OPPORTUNITY DETECTED header', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('OPPORTUNITY DETECTED');
    expect(msg).toContain('74/100');
  });

  test('includes sub-score breakdown line', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('Lock: 18/25');
    expect(msg).toContain('Social: 20/25');
    expect(msg).toContain('On-chain: 18/25');
    expect(msg).toContain('Market: 18/25');
  });

  test('includes social block with twitter handle', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('@TokenHandle');
    expect(msg).toContain('4,200');
    expect(msg).toContain('Positive');
  });

  test('includes dev wallet block', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('0xabc1');
    expect(msg).toContain('142 days');
  });

  test('includes token info section', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('$PEPE');
    expect(msg).toContain('BNB Chain');
  });

  test('includes View Transaction link', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('https://bscscan.com/tx/0x123');
  });

  test('stays under 4000 chars', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg.length).toBeLessThanOrEqual(4000);
  });
});

describe('formatAlert — moderate tier', () => {
  test('no OPPORTUNITY DETECTED header', () => {
    const msg = formatAlert(opportunityCtx({ tier: 'moderate', totalScore: 55 }));
    expect(msg).not.toContain('OPPORTUNITY DETECTED');
  });

  test('shows score in analysis line', () => {
    const msg = formatAlert(opportunityCtx({ tier: 'moderate', totalScore: 55 }));
    expect(msg).toContain('55/100');
  });
});

describe('formatAlert — high-risk tier', () => {
  test('shows condensed format', () => {
    const msg = formatAlert(opportunityCtx({
      tier: 'high-risk', totalScore: 12,
      disqualifierReason: null
    }));
    expect(msg).toContain('High Risk');
    expect(msg).toContain('12/100');
  });

  test('shows disqualifier reason when present', () => {
    const msg = formatAlert(opportunityCtx({
      tier: 'high-risk', totalScore: 0,
      disqualifierReason: 'Dev wallet flagged in rug database'
    }));
    expect(msg).toContain('Dev wallet flagged');
  });
});
```

- [ ] **Step 4.2: Run tests — confirm fail**

```bash
npx jest tests/alert-formatter.test.js --no-coverage 2>&1 | tail -3
```
Expected: `Cannot find module '../lib/alert-formatter'`

- [ ] **Step 4.3: Implement `lib/alert-formatter.js`**

Create `lib/alert-formatter.js`:

```javascript
// lib/alert-formatter.js
// Pure function — builds the Telegram message string from the shared context.
// Returns a string under 4000 chars (Telegram limit enforced here).

const MAX_LENGTH = 4000;

function formatNumber(n) {
  if (n == null) return 'N/A';
  return n.toLocaleString('en-US');
}

function formatUsd(n) {
  if (n == null) return 'N/A';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPrice(p) {
  if (p == null) return 'N/A';
  if (p >= 100) return `$${p.toFixed(2)}`;
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6).replace(/\.?0+$/, '')}`;
  return `$${p.toFixed(8).replace(/\.?0+$/, '')}`;
}

function devWalletShort(addr) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function buildOpportunityHeader(ctx) {
  const lines = [];
  lines.push(`🟢 *OPPORTUNITY DETECTED — Score: ${ctx.totalScore}/100*`);
  lines.push('');
  lines.push(`🧠 Lock: ${ctx.lockScore}/25 | Social: ${ctx.socialScore}/25 | On-chain: ${ctx.onchainScore}/25 | Market: ${ctx.marketScore}/25`);
  lines.push('');

  // Social block
  if (ctx.twitterHandle) {
    const tweetsLine = ctx.twitterActiveLast7Days ? 'Active this week' : 'Inactive';
    lines.push(`🐦 *Social:* ${ctx.twitterHandle} | ${formatNumber(ctx.twitterFollowers)} followers | ${tweetsLine} | Sentiment: ${ctx.twitterSentiment || 'N/A'}`);
  } else {
    lines.push(`🐦 *Social:* No account found`);
  }

  // Dev wallet block
  const walletAge = ctx.devWalletAgeDays != null ? `${ctx.devWalletAgeDays} days old` : 'Age unknown';
  const rugHistory = ctx.devWalletRugsInHuntrDb === 0 ? '0 rugs tracked by Hunt3r' : `⚠️ ${ctx.devWalletRugsInHuntrDb} rug(s) tracked`;
  lines.push(`👤 *Dev Wallet:* ${devWalletShort(ctx.devWallet)} | ${walletAge} | ${rugHistory}`);
  lines.push('');

  return lines.join('\n');
}

function buildStandardBody(ctx) {
  const lines = [];

  // Token info
  lines.push(`💎 *Token info*`);
  lines.push(`Token: $${ctx.tokenSymbol || 'UNKNOWN'}`);
  if (ctx.price != null) lines.push(`Price: ${formatPrice(ctx.price)}`);
  if (ctx.priceChange1h != null) {
    const sign = ctx.priceChange1h >= 0 ? '+' : '';
    lines.push(`1h: ${sign}${ctx.priceChange1h.toFixed(1)}%`);
  }
  if (ctx.marketCap != null) lines.push(`MC: ${formatUsd(ctx.marketCap)}`);
  if (ctx.liquidity != null) lines.push(`Pool Liquidity: ${formatUsd(ctx.liquidity)}`);
  if (ctx.nativeLockedUsd != null && ctx.nativeSymbol) {
    lines.push(`Native Locked: ${formatUsd(ctx.nativeLockedUsd)} in ${ctx.nativeSymbol}`);
  }
  lines.push('');

  // Lock details
  lines.push(`🔐 *Lock details*`);
  if (ctx.lockDurationDays != null) lines.push(`Duration: ${ctx.lockDurationDays} days`);
  if (ctx.lockedPercent != null) lines.push(`Locked: ${ctx.lockedPercent.toFixed(1)}% of LP supply`);
  lines.push(`Platform: ${ctx.source}`);
  lines.push(`Chain: ${ctx.chain}`);
  lines.push('');

  // Security
  lines.push(`⚡ *Security*`);
  lines.push(ctx.contractVerified ? '✅ Verified contract' : '❌ Unverified contract');
  lines.push(ctx.isHoneypot === false ? '✅ Not honeypot' : '⚠️ Honeypot check failed');
  lines.push(ctx.ownershipRenounced ? '✅ Ownership renounced' : '⚠️ Ownership not renounced');
  if (ctx.ownerHoldPercent != null) lines.push(`Owner holds: ${ctx.ownerHoldPercent.toFixed(1)}%`);
  lines.push('');

  // Dev wallet
  lines.push(`👤 *Dev wallet*`);
  lines.push(devWalletShort(ctx.devWallet));
  lines.push('');

  // Trading stats
  lines.push(`📊 *Trading stats*`);
  if (ctx.volume24h != null) lines.push(`Volume 24h: ${formatUsd(ctx.volume24h)}`);
  if (ctx.buySellRatio != null) lines.push(`Buy/Sell ratio: ${ctx.buySellRatio.toFixed(1)}x`);
  if (ctx.holderCount != null) lines.push(`Holders: ${formatNumber(ctx.holderCount)}`);
  lines.push('');

  return lines.join('\n');
}

function formatAlert(ctx) {
  let header = '';
  let body = '';

  if (ctx.tier === 'opportunity') {
    header = buildOpportunityHeader(ctx);
    body = buildStandardBody(ctx);
    body += `[View Transaction](${ctx.explorerLink})`;
  } else if (ctx.tier === 'moderate') {
    header = `🟡 *Lock Detected — Moderate*\n\n🧠 *Analysis:* ${ctx.totalScore}/100 (Moderate)\n\n`;
    body = buildStandardBody(ctx);
    body += `[View Transaction](${ctx.explorerLink})`;
  } else {
    // High risk — condensed format
    const disqLine = ctx.disqualifierReason ? `\n⛔ ${ctx.disqualifierReason}` : '';
    header = `🔒 *Lock Detected — High Risk*\n\n⚠️ *Score: ${ctx.totalScore}/100*\nChain: ${ctx.chain} | Platform: ${ctx.source}\n\nToken: $${ctx.tokenSymbol || 'UNKNOWN'} | Lock: ${ctx.lockDurationDays ?? '?'} days (${ctx.lockedPercent?.toFixed(0) ?? '?'}% of pool)${disqLine}\n\n`;
    body = `[View Transaction](${ctx.explorerLink})`;
  }

  let message = header + body;

  // Enforce 4000-char limit
  if (message.length > MAX_LENGTH) {
    const truncated = message.substring(0, MAX_LENGTH);
    const lastNewline = truncated.lastIndexOf('\n');
    const cutAt = lastNewline > MAX_LENGTH * 0.8 ? lastNewline : MAX_LENGTH;
    message = message.substring(0, cutAt) + `\n\n[View Transaction](${ctx.explorerLink})`;
  }

  return message;
}

module.exports = { formatAlert };
```

- [ ] **Step 4.4: Run tests — confirm all pass**

```bash
npx jest tests/alert-formatter.test.js --no-coverage
```
Expected: `PASS tests/alert-formatter.test.js` — all tests green.

- [ ] **Step 4.5: Commit**

```bash
git add lib/alert-formatter.js tests/alert-formatter.test.js
git commit -m "feat: add alert-formatter with tiered message templates"
```

---

## Task 5: lib/social-scorer.js

**Files:**
- Create: `lib/social-scorer.js`

No unit tests here — depends on Twitter/X API v2 and OpenAI. Manual verification via the bot.

- [ ] **Step 5.1: Create `lib/social-scorer.js`**

```javascript
// lib/social-scorer.js
// Queries Twitter/X API v2 for token social presence, then classifies sentiment
// via OpenAI. Always resolves (never throws) — returns { socialScore: 0 } on any failure.

const { TwitterApi } = require('twitter-api-v2');
const OpenAI = require('openai');

const TIMEOUT_MS = 7000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    )
  ]);
}

async function classifySentiment(tweets) {
  if (!process.env.OPENAI_API_KEY || !tweets || tweets.length === 0) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const tweetText = tweets.slice(0, 10).map(t => t.text).join('\n---\n');

    const response = await withTimeout(
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `You are analyzing a DeFi token's social presence. Classify the overall sentiment of the following tweets from the token's official Twitter account as exactly one of: Positive, Neutral, or Negative. Reply with only that single word.\n\nTweets:\n${tweetText}`
          }
        ],
        max_tokens: 5
      }),
      TIMEOUT_MS
    );

    const raw = response.choices?.[0]?.message?.content?.trim() || '';
    if (['Positive', 'Neutral', 'Negative'].includes(raw)) return raw;
    return 'Neutral'; // Unexpected response → default to Neutral
  } catch {
    return null;
  }
}

async function scoreSocial(tokenSymbol, tokenName) {
  const defaultResult = {
    twitterHandle: null, twitterFollowers: null,
    twitterCreatedAt: null, twitterActiveLast7Days: false,
    twitterSentiment: null, socialScore: 0
  };

  if (!process.env.TWITTER_BEARER_TOKEN) {
    console.log('⚠️ TWITTER_BEARER_TOKEN not set — social score defaulting to 0');
    return defaultResult;
  }

  try {
    const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN);
    const ticker = (tokenSymbol || '').replace(/^[^A-Za-z]/, ''); // strip leading $ if present
    const query = `$${ticker} OR "${tokenName || ticker}"`;

    // Search for accounts mentioning the token
    const searchResult = await withTimeout(
      client.v2.searchRecentTweets(query, {
        'tweet.fields': ['author_id', 'created_at', 'text'],
        max_results: 20
      }),
      TIMEOUT_MS
    );

    if (!searchResult?.data?.data?.length) {
      console.log(`ℹ️ No Twitter results for ${query}`);
      return defaultResult;
    }

    // Find author IDs from results, look for the most likely official account
    const authorIds = [...new Set(searchResult.data.data.map(t => t.author_id))];
    const usersResult = await withTimeout(
      client.v2.users(authorIds.slice(0, 5), {
        'user.fields': ['created_at', 'public_metrics', 'description', 'username']
      }),
      TIMEOUT_MS
    );

    const users = usersResult?.data || [];

    // Pick best match: prefer account whose username/description mentions ticker
    const tickerLower = ticker.toLowerCase();
    let matched = users.find(u =>
      u.username.toLowerCase().includes(tickerLower) ||
      (u.description || '').toLowerCase().includes(tickerLower)
    );
    if (!matched && users.length > 0) {
      // Fall back to highest follower count
      matched = users.reduce((a, b) =>
        (a.public_metrics?.followers_count || 0) > (b.public_metrics?.followers_count || 0) ? a : b
      );
    }

    if (!matched) return defaultResult;

    const handle = `@${matched.username}`;
    const followers = matched.public_metrics?.followers_count || 0;
    const createdAt = matched.created_at;
    const accountAgeDays = createdAt
      ? Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Check for tweets in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentTweets = searchResult.data.data.filter(t =>
      t.author_id === matched.id &&
      t.created_at &&
      new Date(t.created_at) > new Date(sevenDaysAgo)
    );
    const activeLast7Days = recentTweets.length > 0;

    // Sentiment from most recent tweets by this author
    const authorTweets = searchResult.data.data
      .filter(t => t.author_id === matched.id)
      .slice(0, 10);
    const sentiment = await classifySentiment(authorTweets);

    // Compute social score
    let score = 5; // account found
    if (accountAgeDays > 30) score += 5;
    if (followers > 2000) score += 5;
    if (activeLast7Days) score += 5;
    if (sentiment === 'Positive') score += 5;
    else if (sentiment === 'Neutral') score += 2;

    console.log(`🐦 Social score for ${tokenSymbol}: ${score}/25 (${handle}, ${followers} followers, sentiment: ${sentiment})`);

    return {
      twitterHandle: handle,
      twitterFollowers: followers,
      twitterCreatedAt: createdAt || null,
      twitterActiveLast7Days: activeLast7Days,
      twitterSentiment: sentiment,
      socialScore: score
    };
  } catch (err) {
    console.error(`❌ social-scorer failed for ${tokenSymbol}:`, err.message);
    return { ...defaultResult, socialScore: 0 };
  }
}

module.exports = { scoreSocial };
```

- [ ] **Step 5.2: Verify syntax**

```bash
node -e "const { scoreSocial } = require('./lib/social-scorer'); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 5.3: Commit**

```bash
git add lib/social-scorer.js
git commit -m "feat: add social-scorer (Twitter/X + OpenAI sentiment)"
```

---

## Task 6: lib/onchain-analyzer.js

**Files:**
- Create: `lib/onchain-analyzer.js`

- [ ] **Step 6.1: Create `lib/onchain-analyzer.js`**

```javascript
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
```

- [ ] **Step 6.2: Verify syntax**

```bash
node -e "const { analyzeOnchain } = require('./lib/onchain-analyzer'); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 6.3: Commit**

```bash
git add lib/onchain-analyzer.js
git commit -m "feat: add onchain-analyzer (rug DB + Moralis wallet age + Hunt3r DB)"
```

---

## Task 7: lib/alert-router.js

**Files:**
- Create: `lib/alert-router.js`

- [ ] **Step 7.1: Create `lib/alert-router.js`**

```javascript
// lib/alert-router.js
// Handles Telegram delivery based on score tier.
//   - All locks: edits the initial "Fetching..." message in #all-locks
//   - Opportunities (61+): also sends a new message to #opportunities

const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const TOPIC_ALL_LOCKS = process.env.TELEGRAM_TOPIC_ALL_LOCKS;
const TOPIC_OPPORTUNITIES = process.env.TELEGRAM_TOPIC_OPPORTUNITIES;

async function telegramRequest(method, params) {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TOKEN}/${method}`,
      { ...params, parse_mode: 'Markdown', disable_web_page_preview: true },
      { timeout: 10000 }
    );
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const errMsg = err.response?.data?.description || err.message;
    console.error(`❌ Telegram ${method} failed (${status}): ${errMsg}`);
    return null;
  }
}

async function routeAlert(ctx, message) {
  if (!TOKEN || !CHAT_ID) {
    console.error('❌ Missing Telegram credentials — cannot route alert');
    return;
  }

  // Step 1: Edit the existing #all-locks "Fetching..." message
  if (ctx.messageId) {
    await telegramRequest('editMessageText', {
      chat_id: CHAT_ID,
      message_id: ctx.messageId,
      text: message
    });
  }

  // Step 2: If opportunity tier, also post to #opportunities channel
  if (ctx.tier === 'opportunity' && TOPIC_OPPORTUNITIES) {
    await telegramRequest('sendMessage', {
      chat_id: CHAT_ID,
      message_thread_id: parseInt(TOPIC_OPPORTUNITIES),
      text: message
    });
    console.log(`🟢 Opportunity alert posted to #opportunities (score: ${ctx.totalScore})`);
  }
}

module.exports = { routeAlert };
```

- [ ] **Step 7.2: Verify syntax**

```bash
node -e "const { routeAlert } = require('./lib/alert-router'); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 7.3: Commit**

```bash
git add lib/alert-router.js
git commit -m "feat: add alert-router (tiered Telegram channel delivery)"
```

---

## Task 8: Update webhook.js

**Files:**
- Modify: `api/webhook.js`

One targeted change: use `TELEGRAM_TOPIC_ALL_LOCKS` env var instead of `TELEGRAM_TOPIC_DISCUSSION`.

- [ ] **Step 8.1: Update env var reference in webhook.js**

In `api/webhook.js`, find line:
```javascript
const TELEGRAM_TOPIC_DISCUSSION = process.env.TELEGRAM_TOPIC_DISCUSSION;
```

Replace with:
```javascript
const TELEGRAM_TOPIC_ALL_LOCKS = process.env.TELEGRAM_TOPIC_ALL_LOCKS || process.env.TELEGRAM_TOPIC_DISCUSSION;
```

Then find the `sendMessage` call inside `sendTelegramMessage`:
```javascript
      message_thread_id: TELEGRAM_TOPIC_DISCUSSION,
```

Replace with:
```javascript
      message_thread_id: TELEGRAM_TOPIC_ALL_LOCKS,
```

**Note:** The `|| process.env.TELEGRAM_TOPIC_DISCUSSION` fallback means no env var change is needed in Vercel until the new channel is ready — the existing channel keeps working.

- [ ] **Step 8.2: Verify syntax**

```bash
node -e "require('./api/webhook'); console.log('OK');" 2>&1 | head -3
```
Expected: `OK` (Postgres connection error is fine — we just want no syntax errors)

- [ ] **Step 8.3: Commit**

```bash
git add api/webhook.js
git commit -m "feat: update webhook to use TELEGRAM_TOPIC_ALL_LOCKS env var"
```

---

## Task 9: Refactor api/enrich-lock.js as pipeline orchestrator

This is the largest task — wiring all new modules into the existing pipeline. The existing logic (RPC calls, LP detection, token data enrichment) stays **unchanged**. We add social + onchain enrichment to the parallel `Promise.allSettled` block, then replace the message-building and Telegram send section.

**Files:**
- Modify: `api/enrich-lock.js`

- [ ] **Step 9.1: Add module imports at the top of enrich-lock.js**

After the existing `const axios = require("axios");` and `const { ethers } = require("ethers");` lines, add:

```javascript
const { scoreSocial } = require('../lib/social-scorer');
const { analyzeOnchain } = require('../lib/onchain-analyzer');
const { computeScore } = require('../lib/scoring-engine');
const { formatAlert } = require('../lib/alert-formatter');
const { routeAlert } = require('../lib/alert-router');
const LockAlertDatabase = require('../lib/database');
```

- [ ] **Step 9.2: Locate the existing dev wallet variable in enrich-lock.js**

`enrich-lock.js` already has an `extractLockOwner()` function (around line 282) that correctly derives the dev wallet address per platform and event type. It populates a variable called `lockOwner`. Do **not** add a new function. Instead, in Step 9.3, assign `const devWallet = lockOwner;` immediately before the new `Promise.allSettled` block. The `lockOwner` variable is already in scope at that point in the file.

- [ ] **Step 9.3: Extend the parallel enrichment block in enrich-lock.js**

Find the existing `Promise.all` block (around line 1806 in the current file) that looks like:

```javascript
const [enriched, tokenCreationTime, walletCreationTime, nativePrice] = await Promise.all([
  enrichTokenData(tokenData.tokenAddress, chainId),
  getTokenCreationTime(...),
  ...getWalletCreationTime(...),
  getNativeTokenPrice(chainId)...
]);
```

Replace it with:

```javascript
// Use existing lockOwner variable (computed by extractLockOwner() earlier in the file)
const devWallet = lockOwner;

const [enrichedResult, tokenCreationTimeResult, walletCreationTimeResult, nativePriceResult, socialResult, onchainResult] = await Promise.allSettled([
  enrichTokenData(tokenData.tokenAddress, chainId),
  getTokenCreationTime(tokenData.tokenAddress, chainId).catch(err => {
    console.error("Failed to get token creation time:", err.message);
    return null;
  }),
  devWallet
    ? getWalletCreationTime(devWallet, chainId).catch(err => {
        console.error("Failed to get wallet creation time:", err.message);
        return null;
      })
    : Promise.resolve(null),
  getNativeTokenPrice(chainId).catch(err => {
    console.error("Failed to get native token price:", err.message);
    return null;
  }),
  scoreSocial(tokenInfo.symbol, tokenInfo.name || tokenInfo.symbol),
  analyzeOnchain(devWallet, null, chainId)  // top3HolderPercent patched in after allSettled
]);

// Unwrap allSettled results (use new variable names to avoid const redeclaration)
const enriched = enrichedResult.status === 'fulfilled' ? enrichedResult.value : {};
const tokenCreationTime = tokenCreationTimeResult.status === 'fulfilled' ? tokenCreationTimeResult.value : null;
const walletCreationTime = walletCreationTimeResult.status === 'fulfilled' ? walletCreationTimeResult.value : null;
const nativePrice = nativePriceResult.status === 'fulfilled' ? nativePriceResult.value : null;
const social = socialResult.status === 'fulfilled' ? socialResult.value : { socialScore: 0 };
const onchain = onchainResult.status === 'fulfilled' ? onchainResult.value : { onchainScore: 0, devWalletFlagged: false, devWalletAgeDays: null, devWalletRugsInHuntrDb: 0 };
```

**Important:** The existing code after this block references `enriched` and `tokenCreationTime` — those names are preserved above. Any reference to `walletCreationTime` in the existing code below this block should continue to work unchanged.

**Patch `top3HolderPercent` into onchain score after unwrap** — `analyzeOnchain` receives `null` for this signal because `enrichTokenData` runs in parallel. After the unwrap block, add:

```javascript
// Patch top3 concentration signal into onchain score if data is available
if (onchain.onchainScore > 0 && enriched?.securityData?.topHolderPercent != null) {
  const top3 = enriched.securityData.topHolderPercent;
  if (top3 < 20) onchain.onchainScore = Math.min(25, onchain.onchainScore + 4);
}
```

- [ ] **Step 9.4: Build the shared context object and replace scoring + message + Telegram sections**

Find the section in `enrich-lock.js` that calls `calculateOpportunityScore` and builds the Telegram message (around the `scoringData` object and `parts.push(...)` calls).

Replace everything from `const scoringData = {` through the existing `await editTelegramMessage(messageId, finalMessage);` call with:

```javascript
// === V2 PIPELINE: Build context → score → format → route ===

const nativeSymbols = { 1: 'ETH', 56: 'BNB', 137: 'MATIC', 8453: 'ETH' };

// Build shared context object
const ctx = {
  // Identity
  chain: req.body.chain || chain?.name,
  chainId,
  source,
  explorerLink,
  txHash: req.body.txHash,
  messageId: req.body.messageId,
  tokenAddress: tokenData.tokenAddress,
  tokenSymbol: tokenInfo.symbol,
  tokenName: tokenInfo.name || tokenInfo.symbol,
  devWallet,
  nativeSymbol: nativeSymbols[chainId] || 'ETH',

  // Token data (from enrichTokenData)
  price: enriched.price || null,
  priceChange1h: enriched.priceChange1h || null,
  marketCap: enriched.marketCap || null,
  liquidity: enriched.liquidity || null,
  volume24h: enriched.volume24h || null,
  buySellRatio: enriched.txns24h
    ? (enriched.txns24h.buys || 0) / Math.max(enriched.txns24h.sells || 1, 1)
    : null,
  holderCount: enriched.securityData?.holderCount || null,
  lockDurationDays: tokenData.unlockTime
    ? Math.floor((tokenData.unlockTime - Math.floor(Date.now() / 1000)) / 86400)
    : null,
  lockedPercent: lockedPercent ? parseFloat(lockedPercent) : null,
  nativeLockedUsd: nativePrice && enriched.nativeTokenAmount
    ? enriched.nativeTokenAmount * nativePrice
    : null,
  isHoneypot: enriched.securityData?.isHoneypot === false ? false : true,
  contractVerified: enriched.securityData?.isOpenSource === true,
  ownershipRenounced: enriched.securityData?.canTakeBackOwnership === false,
  ownerHoldPercent: enriched.securityData?.ownerPercent || 0,
  top3HolderPercent: enriched.securityData?.topHolderPercent || null,

  // Social (from social-scorer)
  ...social,

  // On-chain (from onchain-analyzer)
  ...onchain,
};

// Score
const scores = computeScore(ctx);
Object.assign(ctx, scores);

// Format message
const message = formatAlert(ctx);

// Route to Telegram
await routeAlert(ctx, message);

// Save enriched record to DB
const db = new LockAlertDatabase();
await db.upsertScores(req.body.txHash, {
  lockScore: ctx.lockScore,
  socialScore: ctx.socialScore,
  onchainScore: ctx.onchainScore,
  marketScore: ctx.marketScore,
  totalScore: ctx.totalScore,
  tier: ctx.tier,
  twitterHandle: ctx.twitterHandle,
  twitterFollowers: ctx.twitterFollowers,
  sentiment: ctx.twitterSentiment,
  devWallet: ctx.devWallet,
  tokenPriceAtLock: ctx.price,
  usdValueAtLock: ctx.nativeLockedUsd,
  tokenAddress: ctx.tokenAddress,
  tokenSymbol: ctx.tokenSymbol
});
```

- [ ] **Step 9.5: Verify build**

```bash
node -e "require('./api/enrich-lock'); console.log('OK');" 2>&1 | head -5
```
Expected: `OK` (a Postgres connection error on the next lines is fine — we only care about syntax). Fix any syntax errors before proceeding. Note: `npm run build` runs `next build` which only compiles Next.js pages and does **not** check `api/` or `lib/` files.

- [ ] **Step 9.6: Run all tests**

```bash
npx jest --no-coverage
```
Expected: all tests passing.

- [ ] **Step 9.7: Commit**

```bash
git add api/enrich-lock.js
git commit -m "feat: wire V2 pipeline — social + onchain enrichment, scoring, tiered routing"
```

---

## Task 10: Deploy and smoke test

- [ ] **Step 10.1: Add env vars to Vercel**

In the Vercel dashboard for `tf-lock-alert-bot`, add:
```
TELEGRAM_TOPIC_ALL_LOCKS   = <message_thread_id for #all-locks>
TELEGRAM_TOPIC_OPPORTUNITIES = <message_thread_id for #opportunities>
TWITTER_BEARER_TOKEN       = <Twitter API v2 bearer token>
MORALIS_API_KEY            = <Moralis API key>
```

- [ ] **Step 10.2: Push to deploy**

```bash
git push origin main
```

Wait for Vercel build to complete (check Vercel dashboard — should be green).

- [ ] **Step 10.3: Verify health endpoint**

```bash
curl https://tf-lock-alert-bot.vercel.app/api/webhook
```
Expected: `{"status":"healthy","timestamp":"...","telegram":true}`

- [ ] **Step 10.4: Send a test lock webhook**

Replay a known-good txHash from the Moralis Stream dashboard to trigger a full pipeline run. Verify in Telegram that:
- `#all-locks` shows the enriched message with `🧠 Analysis: XX/100`
- If the score is 61+, `#opportunities` receives the same message
- No "Fetching..." stuck message

- [ ] **Step 10.5: Verify DB record**

In Vercel Postgres (or via `psql $POSTGRES_URL`):
```sql
SELECT transaction_id, total_score, tier, twitter_handle, dev_wallet
FROM lock_alerts
ORDER BY created_at DESC
LIMIT 1;
```
Expected: new columns populated (tier, total_score, etc.).

---

## Out of Scope (this plan)

- Dashboard (`/locks` public feed + `/dashboard` internal analytics) — covered in `2026-03-23-hunt3r-v2-dashboard.md`
- Price performance columns (1h/6h/24h/7d) — part of the dashboard plan
- Automated outcome tracking for dev_wallets.rug_count — manual process, V2
