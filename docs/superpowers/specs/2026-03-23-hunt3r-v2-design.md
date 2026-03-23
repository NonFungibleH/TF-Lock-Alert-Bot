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
  [Enrichment]         4 sub-modules run in parallel via Promise.all:
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

---

## Scoring Engine

Total score 0–100, composed of four equal 25-point sub-scores.

### Lock Quality (0–25)

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

Implementation: Search Twitter/X API v2 for the token name/ticker. If an account is found, fetch profile metadata (created_at, followers_count) and recent tweets (last 7 days). Pass the most recent 10 tweets to OpenAI with a prompt to classify sentiment as Positive / Neutral / Negative.

### On-chain Score (0–25) — New

| Signal | Points |
|---|---|
| Dev wallet not in any rug database | 8 |
| Dev wallet has no rugs in Hunt3r's own DB | 8 |
| Dev wallet age > 90 days | 5 |
| Top 3 wallets hold < 20% of supply | 4 |

Implementation — three parallel checks:
1. **Rug databases:** Query honeypot.is and rugcheck.xyz with dev wallet address
2. **Moralis wallet history:** Pull previous token deployments from this wallet, check if those tokens still exist and have liquidity
3. **Hunt3r DB:** Cross-reference dev wallet against `dev_wallets` table tracking outcome of all previously detected locks

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
- Dev wallet is flagged in a rug database
- Token is a confirmed honeypot
- Lock duration < 7 days

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

The `#opportunities` post is the same message sent to an additional thread — no duplication of data.

### New Environment Variables

```
TELEGRAM_TOPIC_ALL_LOCKS       # message_thread_id for #all-locks
TELEGRAM_TOPIC_OPPORTUNITIES   # message_thread_id for #opportunities
TWITTER_BEARER_TOKEN           # Twitter API v2 bearer token for search
MORALIS_API_KEY                # Moralis API for wallet history lookups
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

### Internal Analytics — `/dashboard` (password protected)

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

-- Dev wallet reputation tracking
CREATE TABLE IF NOT EXISTS dev_wallets (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  first_seen_at BIGINT NOT NULL,
  total_locks INTEGER DEFAULT 0,
  rug_count INTEGER DEFAULT 0,
  reputation_score INTEGER DEFAULT 50,  -- 0=bad, 100=good
  last_updated BIGINT
);

-- Link locks to dev wallets
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS dev_wallet VARCHAR(255);
ALTER TABLE lock_alerts ADD COLUMN IF NOT EXISTS outcome VARCHAR(20);  -- 'rug', 'live', 'unknown'
```

---

## Performance Considerations

- All enrichment sub-modules run in parallel via `Promise.all` — total enrichment time bounded by slowest single API call (~7s) not sum of all calls (~30s+)
- Twitter/X search and Moralis wallet lookups run in parallel with token data enrichment — zero additional latency vs current flow
- Telegram message capped at 4000 chars with graceful truncation (already implemented)
- Vercel function timeout: target < 15s end-to-end with all parallel calls

---

## Out of Scope (V2)

- Push notifications / email alerts
- User accounts or personal watchlists
- Mobile app
- Audit verification (CertiK, Solidproof API)
- CoinGecko / CMC listing check
- First-block sniper detection (requires full block-level indexing)
