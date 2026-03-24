# Hunt3r.exe Dashboard — Design Spec

**Date:** 2026-03-24
**Goal:** Public-facing `/locks` page showing all scored liquidity locks with filtering and analysis capabilities.

---

## Architecture

### New Files
| File | Purpose |
|---|---|
| `pages/locks.js` | React page — renders dashboard UI, fetches from API |
| `styles/locks.css` | Dashboard-specific styles (dark theme) |

### Modified Files
| File | Change |
|---|---|
| `api/dashboard/locks.js` | Return JSON instead of HTML; include all V2 columns |

### Data Flow
```
Browser → GET /locks
  → pages/locks.js (React SSR/CSR)
  → fetch /api/dashboard/locks (JSON)
  → Postgres lock_alerts table
  → Render AG Grid + stats
```

---

## API: `api/dashboard/locks.js`

Accepts `?tier=opportunity|moderate|high-risk` and `?chain=eth|bsc|polygon|base` query params.

Returns JSON:
```json
{
  "locks": [...],
  "stats": {
    "total": 0,
    "opportunity": 0,
    "moderate": 0,
    "highRisk": 0,
    "chains": ["BSC", "ETH", "MATIC", "BASE"]
  }
}
```

Each lock object:
```json
{
  "txHash": "...",
  "time": "2026-03-24T12:00:00Z",
  "chain": "BSC",
  "token": "PEPE",
  "tokenAddress": "0x...",
  "score": 72,
  "tier": "opportunity",
  "lockScore": 18,
  "socialScore": 15,
  "onchainScore": 20,
  "marketScore": 19,
  "lockedPercent": 85.5,
  "nativeLockedUsd": 12500,
  "marketCap": 2500000,
  "liquidity": 85000,
  "price": 0.0000042,
  "twitterHandle": "@pepecoin",
  "twitterFollowers": 5200,
  "sentiment": "Positive",
  "devWallet": "0x1234...abcd",
  "explorerLink": "https://...",
  "source": "Unicrypt"
}
```

Pagination: `?limit=100&offset=0` (default 100 rows, max 500).
No auth required — public endpoint.

`stats` counts and `chains` list are always computed from the **full unfiltered dataset**, regardless of any `?tier` or `?chain` query params. This allows the UI to show global totals in the stats bar while the grid shows filtered rows. `chains` is an array of distinct `chain_name` strings present in the full dataset, sorted alphabetically.

### Error Responses
- `500 Internal Server Error` — returns `{ "error": "Internal server error", "message": "..." }` JSON (never HTML)
- `400 Bad Request` — returns `{ "error": "Invalid parameter", "message": "..." }` for invalid tier/chain values
- All error responses set `Content-Type: application/json`

### CORS
- No CORS headers needed (same-origin fetch from `/locks` page)

---

## Page: `pages/locks.js`

### Layout (top to bottom)
1. **Header bar** — "🔒 Hunt3r.exe" title + subtitle "Live lock scoring feed"
2. **Stats bar** — 4 cards: Total Locks / Opportunities / Moderate / High Risk (counts)
3. **Controls row** — Tier filter tabs + Chain filter pills + Search input + Auto-refresh toggle
4. **AG Grid table** — full-width, dark theme, paginated (100 rows), sortable/filterable
5. **Footer** — "Powered by Hunt3r.exe · Data updates in real-time"

### Tier Filter Tabs
- All | 🟢 Opportunities | 🟡 Moderate | 🔴 High Risk
- Clicking a tab filters the grid and updates the URL hash (`#opportunity`, `#moderate`, `#high-risk`)
- On page load, read the URL hash and apply the corresponding filter

### Chain Filter Pills
- All | ETH | BSC | MATIC | BASE
- Multi-select not required — single active pill

### Filter Interaction
- Tier tab and chain pill filters are applied **client-side** against the full dataset already held in React state
- The API is always fetched without tier/chain query params — the full dataset (up to the current limit/offset) is returned and filtering happens in the browser
- On auto-refresh, the full dataset is re-fetched (no filter params sent); client-side tier/chain/search filters are re-applied to the new data automatically
- Search input (AG Grid quickFilter) applies on top of the already-filtered tier/chain dataset

### AG Grid Columns
| Column | Field | Width | Notes |
|---|---|---|---|
| Time | time | 150 | Relative ("2m ago") + tooltip with full timestamp |
| Score | score | 90 | Color-coded badge: green ≥61, yellow 31-60, red ≤30 |
| Tier | tier | 110 | Pill badge: opportunity/moderate/high-risk |
| Token | token | 110 | Symbol |
| Chain | chain | 90 | |
| Locked % | lockedPercent | 100 | |
| USD Locked | nativeLockedUsd | 120 | K/M formatted |
| Market Cap | marketCap | 120 | K/M formatted |
| Liquidity | liquidity | 110 | K/M formatted |
| Twitter | twitterHandle | 120 | Clickable link if present |
| Sentiment | sentiment | 100 | Emoji: 😊 Positive / 😐 Neutral / 😟 Negative |
| Dev Wallet | devWallet | 130 | Truncated 0x1234...abcd |
| Sub-scores | lockScore+socialScore+onchainScore+marketScore | 160 | "L:18 S:15 O:20 M:19" |
| Explorer | explorerLink | 80 | "View →" link |

### Null/Missing Data Handling
- `score` null or 0 → display "—" in score badge (no color)
- `tier` null → display "—" (no badge color)
- `twitterHandle` null/empty → display "—" (no link)
- `sentiment` null/empty → display "—"
- `devWallet` null/empty → display "—"
- `lockedPercent`, `nativeLockedUsd`, `marketCap`, `liquidity`, `price` null → display "—"
- Sub-scores: individual null sub-scores display as "—" in the combined cell (e.g. "L:— S:15 O:20 M:19")

### Auto-Refresh
- Toggle button (default ON)
- Polls `/api/dashboard/locks` every 60 seconds
- Shows "Last updated X seconds ago" counter
- New rows flash green briefly on insert
- When toggled OFF, the counter stops and the auto-refresh interval is cleared

### Loading & Error States
- On initial load: show a centered spinner/loading message in place of the grid
- On API error: show an inline error banner above the grid (red background, error message text); do not crash the page
- On auto-refresh error: update the "Last updated" counter to show "Update failed" and retry on the next interval

### Design / CSS
- Background: `#0a0a1a`
- Accent: `#00e5ff` (teal)
- Opportunity green: `#00ff88`
- Moderate yellow: `#ffbb00`
- High-risk red: `#ff4444`
- Font: system-ui
- Stats cards: glassmorphism border (`rgba(0,229,255,0.2)`)
- Fully responsive — on mobile, hide sub-scores and dev wallet columns

---

## Constraints

- No auth — fully public
- No Tailwind, no component library beyond AG Grid (CDN)
- AG Grid Community Edition (free) — CDN loaded, version 31
- Max response size: 500 rows per request
- `api/dashboard/locks.js` is being converted from HTML to JSON — this is a breaking change. The old HTML endpoint at `/api/dashboard/locks` will no longer render a UI; the new `/locks` page replaces it. Any bookmarks to `/api/dashboard/locks` will now receive JSON.
- Do NOT modify Supabase or the lock_alerts schema
- `pages/locks.js` uses React hooks — must be client-side rendered (no SSR for the grid)

---

## Out of Scope
- Authentication / private dashboard
- Price performance columns (1h/6h/24h/7d) — future plan
- Dev wallet detail pages
- Token detail pages
- WebSocket real-time (polling is sufficient)
