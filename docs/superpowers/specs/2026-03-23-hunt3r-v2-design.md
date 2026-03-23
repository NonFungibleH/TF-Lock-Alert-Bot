# Hunt3r.exe V2 — Design Spec
**Date:** 2026-03-23
**Status:** Approved
**Project:** TF-Lock-Alert-Bot (standalone — own DB, own infrastructure, no shared state with other projects)

---

## Overview

Hunt3r.exe is a real-time liquidity lock alert bot for Telegram. It monitors Team Finance and UNCX lock contracts across Ethereum, BNB Chain, Polygon, and Base via Moralis Streams. V2 transforms it from a raw data relay into a genuine investment signal tool — filtering noise, surfacing genuine opportunities, and giving the community actionable intelligence to avoid rugs and identify trustworthy projects locking liquidity.

---

## Goals

1. Improve the scoring engine with social and on-chain signals users can trust
2. Route alerts into tiered Telegram channels based on score
3. Build a public lock feed and an internal analytics dashboard

---

## Architecture — Modular Pipeline

A linear pipeline where each stage receives a shared context object, enriches it, and passes it forward. No stage knows about the others except through that context.

```
Moralis Webhook
      ↓
  [Detection]          shared-lock-detection.js (unchanged)
      ↓
  [Enrichment]         4 sub-modules run in parallel via Promise.allSettled:
    ├── Token Data      DexScreener + DexTools + GoPlus
    ├── Social Score    Twitter/X profile + activity + OpenAI sentiment
    ├── On-chain Score  Rug DB check + Moralis wallet history + Hunt3r DB
    └── Native Price    DexScreener
      ↓
  [Scoring Engine]     combines all sub-scores → single 0–100 score + tier
      ↓
  [Channel Router]     decides which Telegram channel(s) receive the alert
      ↓
  [Alert Formatter]    builds the message appropriate to the tier
      ↓
  [Telegram]           edits initial "Fetching..." message, posts to opportunity channel
      ↓
  [Database]           saves full enriched record to Hunt3r's own Postgres
```

### New Files

```
lib/
  social-scorer.js       Twitter/X research + OpenAI sentiment analysis
  onchain-analyzer.js    Moralis wallet history + rug DB queries + Hunt3r DB lookup
  scoring-engine.js      Consolidates all sub-scores into final score + tier
  alert-router.js        Channel routing rules based on score tier
  alert-formatter.js     Tiered message builder (extracted from enrich-lock.js)
```

`api/enrich-lock.js` becomes the pipeline orchestrator — it calls each module in sequence and manages the shared context. It shrinks significantly as logic moves into focused modules.

### Shared Context Object

The context object is built up through the pipeline. All fields after Detection are populated by their respective stage:

```javascript
{
  // From Detection (shared-lock-detection.js output — unchanged)
  chain: 'BNB Chain',
  chainId: '56',
  type: 'UNCX V4',             // lock type string
  source: 'UNCX',              // 'UNCX' | 'Team Finance'
  explorerLink: 'https://...',
  txHash: '0x...',
  lockLog: { ... },            // raw log object from Moralis
  eventName: 'onDeposit',

  // From enrich-lock.js before enrichment
  tokenAddress: '0x...',
  devWallet: '0x...',          // derived per platform — see Dev Wallet Derivation below
  messageId: 12345,            // Telegram message ID of the "Fetching..." message

  // From Token Data enrichment
  tokenSymbol: 'PEPE',
  tokenName: 'PepeCoin',
  price: 0.0012,
  priceChange1h: 7.6,
  marketCap: 3500,
  liquidity: 2400,
  volume24h: 240,
  buySellRatio: 2.7,
  holderCount: 42,
  lockDurationDays: 365,
  lockedPercent: 75,           // % of LP token total supply locked
  nativeLockedUsd: 1200,
  isHoneypot: false,
  contractVerified: true,
  ownershipRenounced: true,
  ownerHoldPercent: 0,
  top3HolderPercent: 18,       // % of token supply held by top 3 wallets

  // From Social Score enrichment
  twitterHandle: '@TokenHandle',    // null if not found
  twitterFollowers: 4200,
  twitterCreatedAt: '2024-01-15',
  twitterActiveLast7Days: true,
  twitterSentiment: 'Positive',     // 'Positive' | 'Neutral' | 'Negative' | null
  socialScore: 20,

  // From On-chain Score enrichment
  devWalletFlagged: false,          // true if honeypot.is or rugcheck.xyz returns flagged
  devWalletRugsInHuntrDb: 0,        // from dev_wallets.rug_count
  devWalletAgeDays: 142,            // from Moralis wallet first transaction
  onchainScore: 21,

  // From Native Price enrichment
  nativeTokenPriceUsd: 638.5,       // ETH/BNB/POL/ETH price in USD

  // From Scoring Engine
  lockScore: 18,
  marketScore: 20,
  totalScore: 79,
  tier: 'opportunity',              // 'high-risk' | 'moderate' | 'opportunity'
}
```

**Important:** `Promise.allSettled` is used for the parallel enrichment phase, not `Promise.all`. Each sub-module returns `{ score, fields }` even on failure — never throws. This ensures a partial failure (e.g. Twitter rate-limited) produces a partial score rather than aborting the pipeline.

### Dev Wallet Derivation

The dev wallet is extracted from the raw lock event data before enrichment begins. Rules per platform:

| Platform | Event | Dev Wallet Source |
|---|---|---|
| UNCX V2/V4 | `onDeposit` / `onNewLock` / `onLock` | `lockLog.topics[1]` (first indexed param — the locker address) |
| UNCX V3 NFT | `Transfer` (NFT position) | Transaction sender (`txs[0].fromAddress`) |
| Team Finance V3 | `onLock` | `lockLog.topics[1]` (first indexed param) |
| Team Finance V3 NFT | `DepositNFT` | Transaction sender (`txs[0].fromAddress`) |

If derivation fails (e.g. missing topics), `devWallet` is set to `null` and on-chain checks are skipped (on-chain score defaults to 0).

---

## Scoring Engine

Total score 0–100, composed of four equal 25-point sub-scores.

### Lock Quality (0–25)

"% locked" is defined as the percentage of the LP token's total supply that is being locked. This is consistent with the existing enrichment logic.

| Signal | Points |
|---|---|
| Lock duration ≥ 1 year | 10 |
| Lock duration 6–12 months | 7 |
| Lock duration 1–6 months | 4 |
| Lock duration < 1 month | 0 |
| ≥ 75% of liquidity locked | 8 |
| 50–74% locked | 5 |
| 25–49% locked | 3 |
| < 25% locked | 0 |
| Native USD locked ≥ $10K | 7 |
| Native USD locked $1K–$10K | 4 |
| Native USD locked < $1K | 0 |

### Social Score (0–25) — New

| Signal | Points |
|---|---|
| Project Twitter/X account found | 5 |
| Account age > 30 days | 5 |
| Followers > 2K | 5 |
| Active tweets in last 7 days | 5 |
| OpenAI sentiment: Positive | 5 |
| OpenAI sentiment: Neutral | 2 |
| OpenAI sentiment: Negative | 0 |
| No account found | 0 across all social signals |

**Account discovery logic:** Search Twitter/X API v2 for the token ticker (e.g. `$PEPE`). From the results, select the account that best matches using this priority order:
1. Exact handle or display name matches the token name/ticker
2. Highest follower count among results with bio/tweets mentioning the token ticker
3. If no confident match (no results mention the ticker in bio/recent tweets), treat as "not found" — score 0/25

**OpenAI implementation:**
- Model: `gpt-4o-mini`
- Prompt: `"You are analyzing a DeFi token's social presence. Classify the overall sentiment of the following 10 tweets from the token's official Twitter account as exactly one of: Positive, Neutral, or Negative. Reply with only the word. Tweets: [tweet list]"`
- Parse response: trim + match against `['Positive', 'Neutral', 'Negative']`. Any other response → treat as Neutral.

**Failure fallback:** If Twitter API returns 429 (rate limited) or any error, social score defaults to 0 across all signals. The alert still fires — it will show "Social: Unavailable" in the message.

### On-chain Score (0–25) — New

| Signal | Points |
|---|---|
| Dev wallet not flagged in any rug database | 8 |
| Dev wallet has no rugs in Hunt3r's own DB | 8 |
| Dev wallet age > 90 days | 5 |
| Top 3 wallets hold < 20% of supply | 4 |

**Implementation — three parallel checks:**
1. **Rug databases:** Query honeypot.is and rugcheck.xyz with dev wallet address. Either returning flagged = `devWalletFlagged: true` (triggers hard disqualifier)
2. **Moralis wallet history:** Pull first transaction timestamp for this wallet to compute wallet age in days. Moralis wallet history is used for age only — the rug detection relies on Hunt3r's own DB rather than trying to evaluate past token outcomes via Moralis (too slow, too unreliable)
3. **Hunt3r DB:** Look up `dev_wallets` table by wallet address. Use `rug_count` field directly as the "rugs in Hunt3r DB" signal (0 = full 8 pts, ≥1 = 0 pts)

**Cold start note:** At initial deployment the `dev_wallets` table is empty, so every wallet scores full points on the Hunt3r DB check. This is intentional — the signal becomes meaningful over time as the bot accumulates history. The `outcome` column in `lock_alerts` is set to `'unknown'` at save time; a future manual or automated process updates it to `'rug'` or `'live'` which can then increment `dev_wallets.rug_count`.

**Failure fallback:** If rug database APIs are unreachable, `devWalletFlagged` defaults to `false` (optimistic — do not penalise projects for infrastructure failures). If Moralis wallet history call fails, `devWalletAgeDays` defaults to `null` and the 5-point age signal scores 0.

### Market & Safety (0–25)

| Signal | Points |
|---|---|
| Contract verified on-chain | 5 |
| Not a honeypot (GoPlus) | 5 |
| Ownership renounced | 5 |
| Holder count > 100 | 5 |
| Buy/sell ratio > 2x in 24h | 5 |

### Hard Disqualifiers

Score is capped to 0 regardless of other signals if:
- Dev wallet is flagged in a rug database (`devWalletFlagged: true`)
- Token is a confirmed honeypot (`isHoneypot: true`)
- Lock duration < 7 days

Hard-disqualified alerts still post to `#all-locks` — the community benefits from seeing flagged activity. The message will clearly display the reason for disqualification (e.g. "⛔ Dev wallet flagged in rug database").

### Score Tiers

| Range | Tier | Label |
|---|---|---|
| 0–30 | 🔴 | High Risk |
| 31–60 | 🟡 | Moderate |
| 61–100 | 🟢 | Opportunity |

---

## Telegram Channel Structure

Two topics within the existing Hunt3r.exe Telegram group using `message_thread_id`.

```
Hunt3r.exe Group
├── #all-locks        Every lock fires here, regardless of score
└── #opportunities    Score 61+ only, fully enriched format
```

### Initial "Fetching..." Message

When `webhook.js` receives a lock, it immediately sends a basic message to `#all-locks` (using `TELEGRAM_TOPIC_ALL_LOCKS` as `message_thread_id`). The returned `message_id` is stored in the DB alongside the `txHash`. The enrichment pipeline receives this `message_id` and uses `editMessageText` to update it with the enriched alert once scoring is complete.

If the edit fails (e.g. Telegram timeout), the pipeline logs the error and saves the enriched data to the DB — the lock record is not lost even if the Telegram message was not updated.

### Alert Formats by Tier

**🔴 High Risk (0–30) — `#all-locks` only**
```
🔒 Lock Detected — High Risk

⚠️ Score: 12/100
Chain: BNB Chain | Platform: UNCX

Token: $SCAM | Lock: 30 days (5% of pool)
No social presence | Dev wallet flagged

[View Transaction]
```

**🟡 Moderate (31–60) — `#all-locks` only**
Current enriched format (token info, lock details, security, trading stats, links).

**🟢 Opportunity (61+) — `#all-locks` + `#opportunities`**
Standard format with an enhanced header block:
```
🟢 OPPORTUNITY DETECTED — Score: 74/100

🧠 Lock: 18/25 | Social: 20/25 | On-chain: 18/25 | Market: 18/25

🐦 Social: Active (@TokenHandle, 4.2K followers,
   8 tweets this week, Sentiment: Positive)

👤 Dev Wallet: Clean (wallet age 142 days,
   0 previous rugs tracked by Hunt3r)

[...standard enriched alert continues...]
```

The `#opportunities` post is a separate `sendMessage` call to `TELEGRAM_TOPIC_OPPORTUNITIES` — the same message text, different thread. The `#all-locks` message is edited as before.

### New Environment Variables

```
TELEGRAM_TOPIC_ALL_LOCKS       # message_thread_id for #all-locks
TELEGRAM_TOPIC_OPPORTUNITIES   # message_thread_id for #opportunities
TWITTER_BEARER_TOKEN           # Twitter API v2 bearer token for search
MORALIS_API_KEY                # Moralis API for wallet history lookups
DASHBOARD_PASSWORD             # Plaintext password for /dashboard HTTP Basic Auth
```

---

## Dashboard

Single Next.js app within the existing repo. Two routes.

### Public Lock Feed — `/locks`

Filterable, paginated feed of all detected locks. Accessible to anyone.

- Filter by tier (All / Opportunities / Moderate / High Risk)
- Filter by chain and platform
- Each row: token symbol, score, chain, platform, pool size, lock duration, time ago
- Click row → expanded view with full enriched data, sub-score breakdown, price performance since lock (1h / 6h / 24h / 7d)

Price performance columns are populated by the existing `enrich-prices` GitHub Actions workflow which already records `token_price_history` rows at 30m / 1h / 6h / 12h / 24h intervals. For the `/locks` feed, display the 1h / 6h / 24h / 7d snapshots (7d requires adding a 10080-minute entry to the existing workflow's schedule — the only schema change needed).

### Internal Analytics — `/dashboard` (password protected)

Authentication: HTTP Basic Auth using `DASHBOARD_PASSWORD` env var, checked in the Next.js middleware. No user accounts, no sessions — a single shared password is sufficient for internal use.

For monitoring scoring accuracy and tuning thresholds.

Panels:
- **Summary stats:** Total locks / Moderate / Opportunities / Total USD locked (last 7 days)
- **Score distribution:** Bar chart showing % in each tier
- **Opportunity performance:** Average price change at 1h / 6h / 24h / 7d for 61+ score locks — the ground truth for whether scoring is working
- **Repeat offender wallets:** Dev wallets that have appeared multiple times with rug outcomes, exportable as CSV

---

## Database Schema Changes

New tables in Hunt3r's own Postgres instance (no shared DB with other projects).

```sql
-- Enhanced lock_alerts (existing table, new columns added)
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS social_score INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS onchain_score INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS lock_score INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS market_score INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS total_score INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS tier VARCHAR(20);
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS token_price_at_lock DECIMAL;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS usd_value_at_lock DECIMAL;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(100);
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS twitter_followers INTEGER;
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20);
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS dev_wallet VARCHAR(255);
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);  -- 'rug', 'live', 'unknown'

-- Dev wallet reputation tracking
CREATE TABLE IF NOT EXISTS dev_wallets (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  first_seen_at BIGINT NOT NULL,
  total_locks INTEGER DEFAULT 0,
  rug_count INTEGER DEFAULT 0,
  last_updated BIGINT
);
```

---

## Performance Considerations

- All enrichment sub-modules run in parallel via `Promise.allSettled` — total enrichment time bounded by slowest single API call (~7s) not sum of all calls (~30s+)
- Twitter/X search and Moralis wallet lookups run in parallel with token data enrichment — zero additional latency vs current flow
- Telegram message capped at 4000 chars with graceful truncation (already implemented)
- Vercel function timeout: target < 15s end-to-end with all parallel calls
- Each sub-module has an individual 7s timeout — if it exceeds this, it resolves with a zeroed partial result rather than hanging the pipeline

---

## Out of Scope (V2)

- Push notifications / email alerts
- User accounts or personal watchlists
- Mobile app
- Audit verification (CertiK, Solidproof API)
- CoinGecko / CMC listing check
- First-block sniper detection (requires full block-level indexing)
- Automated outcome tracking (marking locks as 'rug'/'live' after the fact — manual process in V2)
