# Hunt3r.exe Dashboard — Implementation Plan

**Date:** 2026-03-24
**Spec:** `docs/superpowers/specs/2026-03-24-hunt3r-dashboard-design.md`
**Deliverable:** Public `/locks` dashboard page with AG Grid, tier/chain filtering, stats bar, and auto-refresh.

---

## Task 1: Update `api/dashboard/locks.js` to return JSON with V2 columns

**File:** `api/dashboard/locks.js`

### What to do
Rewrite the existing handler to return JSON instead of HTML. The old handler returns a full HTML page — replace the entire response with a `res.json(...)` call.

**Query changes:**
- Add columns: `total_score`, `tier`, `social_score`, `onchain_score`, `market_score`, `twitter_handle`, `twitter_followers`, `sentiment`, `dev_wallet`
- Keep existing columns: `transaction_id`, `chain_name`, `source`, `lock_type`, `token_symbol`, `token_address`, `detection_price`, `detection_mcap`, `detection_liquidity`, `lock_score`, `locked_percent`, `native_locked_usd`, `explorer_link`, `created_at`
- Remove: `contract_address`, `event_name`, `enriched_at` (not needed by new UI)

**Query params to support:**
- `?tier=opportunity|moderate|high-risk` — maps to `WHERE tier = $1`
- `?chain=eth|bsc|polygon|base` — maps to `WHERE LOWER(chain_name) = $1`
- `?limit` — default 100, max 500, minimum 1
- `?offset` — default 0, minimum 0
- Invalid `tier` or `chain` values → return `400 { "error": "Invalid parameter", "message": "..." }`

**Stats computation:**
- Always query the full table (without tier/chain filters) for stats counts
- `stats.total` = total row count
- `stats.opportunity` = count where tier = 'opportunity'
- `stats.moderate` = count where tier = 'moderate'
- `stats.highRisk` = count where tier = 'high-risk'
- `stats.chains` = distinct chain_name values from the full table, sorted alphabetically

**Response shape** (camelCase field names):
```js
{
  locks: [
    {
      txHash: row.transaction_id,
      time: row.created_at,           // ISO string
      chain: row.chain_name,
      token: row.token_symbol || 'Unknown',
      tokenAddress: row.token_address,
      score: row.total_score,
      tier: row.tier,
      lockScore: row.lock_score,
      socialScore: row.social_score,
      onchainScore: row.onchain_score,
      marketScore: row.market_score,
      lockedPercent: row.locked_percent,
      nativeLockedUsd: row.native_locked_usd,
      marketCap: row.detection_mcap,
      liquidity: row.detection_liquidity,
      price: row.detection_price,
      twitterHandle: row.twitter_handle,
      twitterFollowers: row.twitter_followers,
      sentiment: row.sentiment,
      devWallet: row.dev_wallet,
      explorerLink: row.explorer_link,
      source: row.source
    }
  ],
  stats: { total, opportunity, moderate, highRisk, chains }
}
```

**Error handling:**
- Catch all DB errors; return `500 { "error": "Internal server error", "message": err.message }`
- All error responses must set `Content-Type: application/json` (use `res.status(500).json(...)`)
- Close the pool with `await pool.end()` in a `finally` block (not inside the try) to ensure it always runs

**Verify:**
```bash
node -e "require('./api/dashboard/locks'); console.log('OK');"
```
Expected: `OK` (no SyntaxError, no import errors)

**Commit:** `feat: update locks API to return V2 JSON with tier + scoring columns`

---

## Task 2: Create `styles/locks.css`

**File:** `styles/locks.css` (new file)

### What to do
Write a standalone CSS file imported by `pages/locks.js`. No Tailwind. Uses CSS custom properties defined in this file (not inherited from a global file).

**CSS variables to define at `:root`:**
```css
--bg: #0a0a1a;
--accent: #00e5ff;
--green: #00ff88;
--yellow: #ffbb00;
--red: #ff4444;
--card-bg: rgba(0, 229, 255, 0.05);
--card-border: rgba(0, 229, 255, 0.2);
--text: #e0e0e0;
--text-muted: rgba(0, 229, 255, 0.7);
```

**Sections to style:**

1. **Page layout** — `body`, `.locks-page` wrapper with `background: var(--bg); color: var(--text); font-family: system-ui`

2. **Header** — `.locks-header` flex row, `.locks-title` in accent color (bold, large), `.locks-subtitle` in muted color

3. **Stats bar** — `.stats-bar` flex row with gap; `.stat-card` with glassmorphism border (`1px solid var(--card-border)`), background `var(--card-bg)`, border-radius 8px, padding; `.stat-label` uppercase small text; `.stat-value` large bold text in accent color

4. **Controls row** — `.controls-row` flex row with gap and margin; wraps on small screens

5. **Tier filter tabs** — `.tier-tabs` container; `.tier-tab` button with border, background, padding; `.tier-tab.active` with filled background; per-tier active colors: `--green` for opportunity, `--yellow` for moderate, `--red` for high-risk, `--accent` for all

6. **Chain pills** — `.chain-pills` container; `.chain-pill` smaller button-like pill; `.chain-pill.active` with accent fill

7. **Search input** — `.search-input` dark background, accent border, accent text placeholder

8. **Auto-refresh controls** — `.refresh-controls` flex row; `.refresh-toggle` button; `.last-updated` small muted text showing the counter; `.refresh-toggle.active` green tint; `.refresh-toggle.off` dim/grey

9. **Score badges** — `.score-badge` base style; `.score-badge.high` green; `.score-badge.medium` yellow; `.score-badge.low` red; `.score-badge.empty` grey/dim

10. **Tier badges** — `.tier-badge` pill shape; `.tier-badge.opportunity` green; `.tier-badge.moderate` yellow; `.tier-badge.high-risk` red

11. **AG Grid dark theme overrides** — target `.ag-theme-alpine` CSS variables:
    - `--ag-background-color: #1a1a2e`
    - `--ag-header-background-color: #0f0f1e`
    - `--ag-odd-row-background-color: #16162a`
    - `--ag-header-foreground-color: var(--accent)`
    - `--ag-foreground-color: var(--text)`
    - `--ag-border-color: var(--card-border)`
    - `--ag-row-hover-color: rgba(0, 229, 255, 0.1)`
    - `--ag-selected-row-background-color: rgba(0, 229, 255, 0.2)`

12. **New row flash** — `.row-flash` keyframe animation: brief green background flash (opacity 0.3 → 0), 1.5s ease-out

13. **Loading state** — `.loading-state` centered spinner/text overlay above the grid area

14. **Error banner** — `.error-banner` red background bar, white text, padding, border-radius

15. **Footer** — `.locks-footer` small centered muted text

16. **Responsive (≤768px):**
    - Stack `.stats-bar` cards vertically (or 2-column grid)
    - Stack `.controls-row` vertically
    - The AG Grid column hiding for sub-scores and dev wallet is handled in JS (column definitions), not CSS

**Commit:** `feat: add locks dashboard CSS`

---

## Task 3: Create `pages/locks.js`

**File:** `pages/locks.js` (new file)

### What to do
React page component using Next.js pages router. AG Grid is loaded via CDN script tags (not npm), so use a dynamic Script import or inject via `useEffect`. The grid must only render client-side (no SSR).

**Imports:**
```js
import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import '../styles/locks.css'
```

**State:**
- `allLocks` — full dataset from API (array)
- `filteredLocks` — allLocks after tier + chain filter applied
- `stats` — `{ total, opportunity, moderate, highRisk, chains }`
- `activeTier` — `'all' | 'opportunity' | 'moderate' | 'high-risk'`
- `activeChain` — `'all' | 'ETH' | 'BSC' | 'MATIC' | 'BASE'`
- `loading` — boolean (true on initial load)
- `error` — string or null
- `autoRefresh` — boolean (default true)
- `lastUpdated` — Date or null
- `secondsAgo` — number (for the counter display)
- `gridApi` — ref to AG Grid API instance

**AG Grid loading:**
The `ag-grid-community` CDN script must be loaded before the grid is created. Use `next/script` with `strategy="afterInteractive"` and an `onLoad` callback that initializes the grid. Or load both scripts in `<Head>` and create the grid in a `useEffect` that checks `typeof agGrid !== 'undefined'`.

**Recommended approach:**
1. Add AG Grid CDN links in `<Head>` (CSS) and use `next/script` for the JS
2. Track an `agGridReady` state (boolean); set to true in the script's `onLoad`
3. In a `useEffect([agGridReady, filteredLocks])`, create the grid when both are ready

**Grid initialization:**
```js
const gridOptions = {
  columnDefs: [...],  // see column definitions below
  rowData: filteredLocks,
  defaultColDef: { sortable: true, filter: true, resizable: true, floatingFilter: true },
  pagination: true,
  paginationPageSize: 100,
  animateRows: true,
  enableCellTextSelection: true,
  getRowId: params => params.data.txHash,  // stable row IDs for flash detection
}
gridApi.current = agGrid.createGrid(document.getElementById('locksGrid'), gridOptions)
```

**Column definitions:**

```js
[
  {
    headerName: 'Time', field: 'time', width: 150, sortable: true,
    cellRenderer: p => relativeTime(p.value),  // "2m ago"
    tooltipValueGetter: p => p.value,           // full ISO timestamp in tooltip
  },
  {
    headerName: 'Score', field: 'score', width: 90, sortable: true,
    cellRenderer: p => scoreBadge(p.value),
  },
  {
    headerName: 'Tier', field: 'tier', width: 110,
    cellRenderer: p => tierBadge(p.value),
  },
  { headerName: 'Token', field: 'token', width: 110, filter: true },
  { headerName: 'Chain', field: 'chain', width: 90, filter: true },
  {
    headerName: 'Locked %', field: 'lockedPercent', width: 100,
    valueFormatter: p => p.value != null ? p.value.toFixed(1) + '%' : '—',
  },
  {
    headerName: 'USD Locked', field: 'nativeLockedUsd', width: 120,
    valueFormatter: p => formatUsd(p.value),
  },
  {
    headerName: 'Market Cap', field: 'marketCap', width: 120,
    valueFormatter: p => formatUsd(p.value),
  },
  {
    headerName: 'Liquidity', field: 'liquidity', width: 110,
    valueFormatter: p => formatUsd(p.value),
  },
  {
    headerName: 'Twitter', field: 'twitterHandle', width: 120,
    cellRenderer: p => p.value ? `<a href="https://twitter.com/${p.value.replace('@','')}" target="_blank" style="color:#00e5ff">${p.value}</a>` : '—',
  },
  {
    headerName: 'Sentiment', field: 'sentiment', width: 100,
    cellRenderer: p => sentimentEmoji(p.value),
  },
  {
    headerName: 'Dev Wallet', field: 'devWallet', width: 130,
    cellRenderer: p => p.value ? truncateAddress(p.value) : '—',
    hide: false,  // hidden on mobile via responsive column state
  },
  {
    headerName: 'Sub-scores', width: 160,
    valueGetter: p => p.data,
    cellRenderer: p => {
      const d = p.value
      const fmt = v => v != null ? v : '—'
      return `L:${fmt(d.lockScore)} S:${fmt(d.socialScore)} O:${fmt(d.onchainScore)} M:${fmt(d.marketScore)}`
    },
    hide: false,  // hidden on mobile
    sortable: false,
    filter: false,
  },
  {
    headerName: 'Explorer', field: 'explorerLink', width: 80,
    cellRenderer: p => p.value ? `<a href="${p.value}" target="_blank" style="color:#00e5ff">View →</a>` : '—',
    sortable: false, filter: false,
  },
]
```

**Helper functions (pure JS, defined above the component):**

```js
function relativeTime(isoString) { /* "2m ago", "1h ago", "3d ago" */ }
function scoreBadge(score) {
  if (!score) return '<span class="score-badge empty">—</span>'
  const cls = score >= 61 ? 'high' : score >= 31 ? 'medium' : 'low'
  return `<span class="score-badge ${cls}">${score}</span>`
}
function tierBadge(tier) {
  if (!tier) return '<span class="tier-badge">—</span>'
  return `<span class="tier-badge ${tier}">${tier}</span>`
}
function sentimentEmoji(s) {
  if (!s) return '—'
  if (s === 'Positive') return '😊 Positive'
  if (s === 'Negative') return '😟 Negative'
  return '😐 Neutral'
}
function truncateAddress(addr) {
  if (!addr || addr.length < 10) return addr || '—'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
function formatUsd(val) {
  if (val == null) return '—'
  if (val >= 1_000_000) return '$' + (val / 1_000_000).toFixed(2) + 'M'
  if (val >= 1_000) return '$' + (val / 1_000).toFixed(1) + 'K'
  return '$' + val.toFixed(2)
}
```

**Data fetching:**

```js
async function fetchLocks() {
  const res = await fetch('/api/dashboard/locks?limit=500')
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}
```

**Filter logic:**

```js
function applyFilters(locks, tier, chain) {
  return locks.filter(l => {
    const tierMatch = tier === 'all' || l.tier === tier
    const chainMatch = chain === 'all' || (l.chain || '').toUpperCase() === chain.toUpperCase()
    return tierMatch && chainMatch
  })
}
```

**URL hash sync:**
- On mount: `const hash = window.location.hash.replace('#', '')` → if it matches a valid tier, set `activeTier`
- On tier tab click: `window.location.hash = tier === 'all' ? '' : tier`

**Auto-refresh:**
- `useEffect([autoRefresh])`: if `autoRefresh`, set an interval calling `fetchLocks()` every 60s; on new data, detect new `txHash` values vs previous and apply `.row-flash` class to new rows via `gridApi.current.flashCells()`
- Return cleanup function that clears the interval

**Seconds-ago counter:**
- A separate `setInterval` (1s) that increments `secondsAgo` and updates the display
- Resets to 0 after each successful fetch

**Mobile responsive columns:**
- After grid is created, add a `resize` event listener: if `window.innerWidth < 768`, call `gridApi.current.setColumnsVisible(['devWallet', 'Sub-scores'], false)` else show them
- Also call on mount

**JSX structure:**
```jsx
<>
  <Head>
    <title>Hunt3r.exe — Live Lock Feed</title>
    <link rel="stylesheet" href="AG Grid CSS CDN URL" />
  </Head>
  <Script src="AG Grid JS CDN URL" strategy="afterInteractive" onLoad={() => setAgGridReady(true)} />

  <div className="locks-page">
    <header className="locks-header">...</header>
    <div className="stats-bar">
      {/* 4 stat cards */}
    </div>
    <div className="controls-row">
      <div className="tier-tabs">...</div>
      <div className="chain-pills">...</div>
      <input className="search-input" ... />
      <div className="refresh-controls">...</div>
    </div>
    {loading && <div className="loading-state">Loading locks...</div>}
    {error && <div className="error-banner">{error}</div>}
    <div id="locksGrid" className="ag-theme-alpine" style={{ height: 'calc(100vh - 280px)', width: '100%' }} />
    <footer className="locks-footer">Powered by Hunt3r.exe · Data updates in real-time</footer>
  </div>
</>
```

**Verify:**
```bash
node -e "require('./pages/locks'); console.log('OK');" 2>&1 | head -3
```
A SyntaxError will be visible in the first 3 lines. React/Next.js import errors are expected and fine — only SyntaxErrors matter.

**Commit:** `feat: add /locks public dashboard page`

---

## Task 4: Wire up navigation (optional)

**File:** Check for a layout or nav component in `pages/_app.js`, `components/`, or `pages/index.js`

### What to do
- Inspect the project's existing nav/header (if any)
- If a nav exists, add a link: `<a href="/locks">🔒 Live Feed</a>`
- If no nav exists (standalone API project), skip this task

**Verify:** Page loads in browser at `http://localhost:3000/locks`

**Commit:** `feat: add locks link to nav`

---

## Task 5: Deploy and verify

### What to do
1. Run `npm run build` locally to confirm no TypeScript/build errors before pushing
2. Push to main: `git push origin main`
3. Monitor Vercel deploy (auto-triggered by push to `main`)
4. Verify live URL: `https://tf-lock-alert-bot.vercel.app/locks`
   - Stats bar shows counts
   - Grid populates with data
   - Tier tabs filter correctly
   - Chain pills filter correctly
   - Auto-refresh fires after 60s (verify with browser network tab)
5. Verify API endpoint directly: `https://tf-lock-alert-bot.vercel.app/api/dashboard/locks` returns JSON (not HTML)

**No separate commit** — this is a deploy verification step.

---

## Implementation Order

Tasks must be completed in order (each builds on the previous):
1. Task 1 first — page depends on the API returning correct JSON shape
2. Task 2 second — CSS must exist before the page imports it
3. Task 3 third — page implementation
4. Task 4 optional — can be skipped if no nav exists
5. Task 5 last — deploy only after local build passes
