# CLAUDE.md — Hunt3r.exe Lock Alert Bot

## What This Bot Does

Hunt3r.exe monitors liquidity lock events on EVM blockchains in real time. When a token developer locks liquidity on **Team Finance** or **UNCX**, the bot:

1. Receives a webhook from **Moralis Streams**
2. Detects the lock event and identifies the platform/chain
3. Sends an immediate "basic" Telegram alert to the community
4. Fires a background enrichment request that fetches token data, security checks, pool stats, and dev wallet info
5. Edits the original Telegram message with the full enriched alert
6. Saves the lock to a Postgres database for the dashboard

---

## Telegram Message Format

This is the target output format for every enriched alert:

```
🔒 New LP lock detected

🧠 Analysis: 20/100 (High Risk). Weak fundamentals - high risk. Early entry opportunity but expect high volatility.

💎 Token info
Token: $SDC
Pool Age: 2h 16m
Price: $0.003482
1h: +7.6%
MC: $3.5K
Pair: SDC/WBNB
Pool Liquidity: $317
Native in Pool: 0.2476 BNB ($157.89)

🔐 Lock details
Amount: 105 tokens ($158.75)
Locked Liquidity: 50.0% of pool
Native Locked: 0.1238 BNB ($78.95)
Duration: 12 months
Platform: UNCX
Chain: BNB Chain

⚡ Security
✅ Owner holds: 0.0%
✅ Verified contract
✅ Not honeypot
✅ Ownership renounced

👤 Dev wallet
0x0dfa...f540
History: Not yet tracked

📊 Trading stats
Volume 24h: $240
Buys/Sells: 24/9 (2.7x more buys)
Holders: 11

⚠️ Warnings
⚠️ LP lock value under $1,000

🔗 Links
DexScreener | DexTools | TokenSniffer
🔍 Search on X

⚡ Snipe
Unibot | Banana Gun | Maestro
🛒 Buy on PancakeSwap

View Transaction
```

---

## Stack & Dependencies

| Package | Purpose |
|---|---|
| Next.js 14 | App framework — API routes are serverless functions on Vercel |
| ethers v5 | ABI decoding, RPC calls, pool address computation |
| axios | HTTP requests (Telegram, DexScreener, GoPlus, Moralis) |
| pg | Postgres client (Vercel Postgres) |
| twitter-api-v2 | Post marketing tweets as Hunt3r.exe |
| openai | GPT-powered tweet generation |
| js-sha3 | keccak256 for event topic matching |
| tailwindcss | Dashboard styling only |

**No Tailwind in API logic. No ORM. Keep it that way.**

---

## Directory Map

```
api/
  webhook.js             Entry point — receives Moralis Stream POST, detects lock, sends basic Telegram, triggers enrichment
  enrich-lock.js         Enrichment — fetches token data, security, pool stats, edits Telegram message
  twitter-marketing.js   OpenAI-powered tweet generator, posts as Hunt3r.exe
  report.js              Daily summary — cron job at 09:00 UTC
  locks.js               API for dashboard — returns recent lock alerts
  webhook-db.js          Alternate webhook variant with direct DB writes
  twitter-webhook.js     Twitter-specific webhook handler
  dashboard/
    locks.js             Dashboard data endpoint
    enrich-prices.js     Price enrichment for historical dashboard data
    cleanup.js           DB cleanup endpoint

lib/
  database.js            Postgres class — lock_alerts + token_price_history tables
  token-decoder.js       Decodes token address from raw tx receipt logs (Team Finance + UNCX)

shared-lock-detection.js Core detection — matches logs against known contract addresses + event topics

pages/
  api/locks.js           Next.js API route mirror for dashboard

public/
  dashboard.html         Static lock performance dashboard

.github/workflows/
  enrich-prices.yml      GitHub Actions — scheduled price enrichment
  post-marketing.yml     GitHub Actions — scheduled Hunt3r.exe tweets

vercel.json              Cron: /api/report at 09:00 UTC daily
```

---

## Data Pipeline

### Step 1 — Moralis Stream → webhook.js

Moralis Streams watches Team Finance and UNCX contracts on all 4 chains. When a matching transaction occurs, Moralis sends a POST to `/api/webhook` containing:
- `chainId` (hex or decimal)
- `logs[]` — decoded event logs with `address`, `topic0`, `name`, `data`, `topics`
- `txs[]` — transaction metadata
- `txsInternal[]` — internal ETH/BNB transfers (used for fee detection)
- `abi[]` — optional ABI for event decoding

### Step 2 — Lock Detection (shared-lock-detection.js)

`detectLock(body)` scans the logs for entries where:
- `log.address` matches a known Team Finance or UNCX contract address
- `log.name` / `topic0` matches a known lock event

Returns: `{ chain, type, source, explorerLink, txHash, lockLog, eventName }` or `null`.

Duplicate prevention via in-memory `sentTxs` Set (capped at 1000, rolling).

### Step 3 — Basic Telegram Alert

Sent immediately before enrichment, so the community sees the lock instantly:
```
🔒 NEW LOCK DETECTED
Chain: BNB Chain
Source: UNCX
Type: UNCX V4
⏳ Fetching token details...
[View Transaction](explorerLink)
```

### Step 4 — Enrichment (enrich-lock.js)

Triggered via non-blocking `axios.post` to `/api/enrich-lock`. Does:
1. Decode token address from raw log data (per platform/event type)
2. Detect if locked asset is an LP token (calls `token0()` / `token1()`)
3. For V3 NFT locks: query NFT position manager for pool + token pair
4. Fetch token symbol/decimals/totalSupply from RPC
5. Fetch price, volume, holders, buy/sell ratio from **DexScreener**
6. Fetch security data (honeypot, ownership, verified) from **GoPlus Security API**
7. Compute pool age, locked %, locked USD value, native in pool
8. Extract dev wallet address from event topics/data
9. Detect warning patterns (lock < $1000, duration < 1 week, low % locked, etc.)
10. Edit the Telegram message with the full enriched alert

### Step 5 — Database Save

Saved to `lock_alerts` table via `LockAlertDatabase.addLockAlert()`. Also writes `token_price_history` at 30m / 1h / 6h / 12h / 24h intervals via the `enrich-prices` workflow.

---

## Supported Chains

| chainId | Name | Native | Explorer |
|---|---|---|---|
| 1 | Ethereum | ETH | etherscan.io |
| 56 | BNB Chain | BNB | bscscan.com |
| 137 | Polygon | POL | polygonscan.com |
| 8453 | Base | ETH | basescan.org |

---

## Supported Lock Platforms & Contracts

### Team Finance (V3 only)
| Chain | Address |
|---|---|
| Ethereum | `0xe2fe530c047f2d85298b07d9333c05737f1435fb` |
| BSC | `0x0c89c0407775dd89b12918b9c0aa42bf96518820` |
| Base | `0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a` |
| Polygon | `0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7` |

**Events:** `onLock`, `DepositNFT`

### UNCX (V2/V3/V4, all DEX variants)
Contracts are in `shared-lock-detection.js → UNCX_CONTRACTS`. Covers Uniswap V2, PancakeSwap V2, SushiSwap V2, and V3/V4 NFT lockers across all chains.

**Events:** `onDeposit`, `onNewLock`, `onLock`, `Transfer`

---

## External APIs

| Service | Used For | Env Var |
|---|---|---|
| Moralis Streams | Webhook source — sends lock events | *(configured in Moralis dashboard, not in code)* |
| Telegram Bot API | Send + edit alert messages | `TELEGRAM_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, `TELEGRAM_TOPIC_DISCUSSION` |
| DexScreener API | Token price, volume, liquidity, pool age, buy/sell stats | *(public, no key)* |
| GoPlus Security API | Honeypot check, ownership, contract verification | *(public, no key needed for basic)* |
| OpenAI | Hunt3r.exe tweet generation | `OPENAI_API_KEY` |
| Twitter/X API v2 | Post marketing tweets | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` |
| Vercel Postgres | Lock storage + price history | `POSTGRES_URL` |
| RPC providers | On-chain reads (token info, pool state, NFT positions) | `ETHEREUM_RPC`, `BSC_RPC`, `POLYGON_RPC`, `BASE_RPC` |

---

## Environment Variables

```
# Telegram
TELEGRAM_TOKEN
TELEGRAM_GROUP_CHAT_ID
TELEGRAM_TOPIC_DISCUSSION    # message thread ID for the alert topic

# Twitter/X
TWITTER_API_KEY
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_SECRET

# OpenAI
OPENAI_API_KEY

# Vercel Postgres
POSTGRES_URL

# RPC (optional — falls back to public RPCs)
ETHEREUM_RPC
BSC_RPC
POLYGON_RPC
BASE_RPC

# Vercel (auto-set in production)
BASE_URL    # used to build enrichment URL — defaults to https://tf-lock-alert-bot.vercel.app
```

---

## Database Schema

### `lock_alerts`
```
id                  SERIAL PK
transaction_id      VARCHAR UNIQUE    ← txHash
lock_type           VARCHAR           ← e.g. "UNCX V4", "V3 Token"
platform            VARCHAR           ← "Team Finance" | "UNCX"
chain_name          VARCHAR
chain_id            VARCHAR
contract_address    VARCHAR           ← locker contract address
event_name          VARCHAR           ← raw event name (onLock, DepositNFT, etc.)
token_address       VARCHAR
token_symbol        VARCHAR
token_amount        DECIMAL
token_price_at_lock DECIMAL
usd_value_at_lock   DECIMAL
current_token_price DECIMAL
explorer_link       TEXT
lock_timestamp      BIGINT            ← unix seconds
created_at          BIGINT            ← unix seconds (default: now)
```

### `token_price_history`
```
id                      SERIAL PK
transaction_id          FK → lock_alerts
token_address           VARCHAR
token_symbol            VARCHAR
price                   DECIMAL
timestamp_recorded      BIGINT
time_since_lock_minutes INTEGER       ← 30, 60, 360, 720, 1440
price_change_percent    DECIMAL
```

---

## Moralis Streams Setup

Moralis Streams must be configured in the Moralis dashboard to:
- Watch the Team Finance and UNCX contract addresses listed above
- Send webhooks to `https://tf-lock-alert-bot.vercel.app/api/webhook`
- Include decoded logs (ABI decoding enabled)
- Include `txsInternal` (needed for lock fee detection)
- Cover all 4 chains (separate streams per chain or multi-chain stream)

The webhook endpoint accepts **POST** only. GET returns a health check.

---

## Bot Persona — Hunt3r.exe

Twitter/X identity used for marketing tweets. Key traits:
- Sharp-eyed DeFi tracker sharing practical tips
- Casual, warning, or insightful tone — "chatting with peers over coffee"
- 0–1 emojis max, no hype words (no "amazing", "secret", "VIP", "proven")
- Tweet topics rotate: importance of locks, red flags, how locks work, DD checklist, trust indicators, common scams, community benefits
- 40% chance of including a CTA linking to the Telegram community

Telegram community link: `https://t.co/iEAhyR2PgC`

---

## Warning Detection Rules

These warnings are appended to alerts when triggered:

| Condition | Warning |
|---|---|
| LP lock USD value < $1,000 | ⚠️ LP lock value under $1,000 |
| Lock duration < 7 days | ⚠️ Lock duration less than 1 week |
| Locked % < 5% of supply | ⚠️ Less than 5% of supply locked |
| Lock % > 80% but duration < 1 day | ⚠️ High % locked but very short duration |
| Lock expires in < 1 hour | 🔴 Lock expires in less than 1 hour! |

---

## Deployment

**Platform:** Vercel (serverless)
**Repo:** `NonFungibleH/TF-Lock-Alert-Bot` on GitHub → auto-deploys `main`
**Cron:** `vercel.json` runs `/api/report` at 09:00 UTC daily (Vercel cron)
**GitHub Actions:**
- `enrich-prices.yml` — scheduled price enrichment for historical data
- `post-marketing.yml` — scheduled Hunt3r.exe tweet posting

```bash
npm run dev     # local dev on localhost:3000
npm run build   # production build check
git push origin main  # triggers Vercel auto-deploy
```

---

## Common Mistakes & Hard Rules

### ❌ NEVER
- Modify Moralis Stream contract addresses without updating `shared-lock-detection.js` — both must stay in sync
- Use `.eq('is_approved', ...)` style queries — this is a lock bot, not a gym app
- Await the enrichment call in `webhook.js` — Vercel functions time out at 10s, enrichment takes up to 45s. It must fire-and-forget
- Change the Telegram `parse_mode` from `"Markdown"` without testing — special chars break formatting
- Remove the `sentTxs` deduplication in `shared-lock-detection.js` — Moralis often sends duplicate webhooks

### ⚠️ WATCH OUT FOR
- `chainId` comes in as hex (`0x38`) or decimal string — always run through `toDecChainId()` before use
- LP tokens have `token0()` / `token1()` methods; regular ERC20s don't — `checkIfLPToken()` uses this to distinguish them
- UNCX V3 locks use NFT position IDs, not raw token addresses — must query the NFT position manager contract
- `latitude`/`longitude` fields do not exist here — this is not the GymMaps project
- Token symbol decoding from raw hex requires skipping the first 64 chars (offset) — see `lib/token-decoder.js`
- All RPC calls race multiple providers in parallel (`Promise.any`) — don't revert to sequential fallback

### Canonical Imports
```javascript
const { detectLock } = require('../shared-lock-detection');
const LockAlertDatabase = require('../lib/database');
const { decodeTokenAddress, getTokenMetadata } = require('../lib/token-decoder');
```
