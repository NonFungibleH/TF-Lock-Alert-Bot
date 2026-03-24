import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Script from 'next/script'

// ─── Pure helper functions ────────────────────────────────────────────────────

function relativeTime(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function scoreBadge(score) {
  if (score == null) return '<span class="score-badge empty">—</span>'
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
  return '$' + Number(val).toFixed(2)
}

function applyFilters(locks, tier, chain) {
  return locks.filter(l => {
    const tierMatch = tier === 'all' || l.tier === tier
    const chainMatch = chain === 'all' || (l.chain || '').toUpperCase() === chain.toUpperCase()
    return tierMatch && chainMatch
  })
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMN_DEFS = [
  {
    headerName: 'Time', field: 'time', width: 120, sortable: true,
    cellRenderer: p => relativeTime(p.value),
    tooltipValueGetter: p => p.value ? new Date(p.value).toLocaleString() : '',
    sort: 'desc',
  },
  {
    headerName: 'Score', field: 'score', width: 90, sortable: true,
    cellRenderer: p => scoreBadge(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Tier', field: 'tier', width: 120,
    cellRenderer: p => tierBadge(p.value),
    filter: true,
  },
  { headerName: 'Token', field: 'token', width: 100, filter: true },
  { headerName: 'Chain', field: 'chain', width: 85, filter: true },
  {
    headerName: 'Locked %', field: 'lockedPercent', width: 100,
    valueFormatter: p => p.value != null ? p.value.toFixed(1) + '%' : '—',
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'USD Locked', field: 'nativeLockedUsd', width: 120,
    valueFormatter: p => formatUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Mkt Cap', field: 'marketCap', width: 110,
    valueFormatter: p => formatUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Liquidity', field: 'liquidity', width: 105,
    valueFormatter: p => formatUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Twitter', field: 'twitterHandle', width: 120,
    cellRenderer: p => p.value
      ? `<a href="https://twitter.com/${p.value.replace('@', '')}" target="_blank" style="color:#00e5ff">${p.value}</a>`
      : '—',
    filter: true,
  },
  {
    headerName: 'Sentiment', field: 'sentiment', width: 120,
    cellRenderer: p => sentimentEmoji(p.value),
    filter: true,
  },
  {
    headerName: 'Dev Wallet', field: 'devWallet', width: 130,
    cellRenderer: p => p.value ? truncateAddress(p.value) : '—',
    filter: true,
  },
  {
    headerName: 'Sub-scores', width: 160,
    valueGetter: p => p.data,
    cellRenderer: p => {
      const d = p.value
      const fmt = v => v != null ? v : '—'
      return `<span style="font-size:11px;color:#888">L:${fmt(d.lockScore)} S:${fmt(d.socialScore)} O:${fmt(d.onchainScore)} M:${fmt(d.marketScore)}</span>`
    },
    sortable: false,
    filter: false,
  },
  {
    headerName: 'Explorer', field: 'explorerLink', width: 85,
    cellRenderer: p => p.value
      ? `<a href="${p.value}" target="_blank" style="color:#00e5ff">View →</a>`
      : '—',
    sortable: false,
    filter: false,
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function LocksPage() {
  const [allLocks, setAllLocks] = useState([])
  const [stats, setStats] = useState({ total: 0, opportunity: 0, moderate: 0, highRisk: 0, chains: [] })
  const [activeTier, setActiveTier] = useState('all')
  const [activeChain, setActiveChain] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [agGridReady, setAgGridReady] = useState(false)
  const gridApi = useRef(null)
  const prevTxHashes = useRef(new Set())

  // Derived filtered locks
  const filteredLocks = applyFilters(allLocks, activeTier, activeChain)

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/locks?limit=500')
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()
      setAllLocks(data.locks || [])
      setStats(data.stats || { total: 0, opportunity: 0, moderate: 0, highRisk: 0, chains: [] })
      setLastUpdated(new Date())
      setSecondsAgo(0)
      setError(null)

      // Flash new rows
      if (gridApi.current && prevTxHashes.current.size > 0) {
        const newHashes = (data.locks || [])
          .filter(l => !prevTxHashes.current.has(l.txHash))
          .map(l => l.txHash)
        if (newHashes.length > 0) {
          gridApi.current.flashCells({ rowNodes: newHashes.map(id => gridApi.current.getRowNode(id)).filter(Boolean) })
        }
      }
      prevTxHashes.current = new Set((data.locks || []).map(l => l.txHash))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Initial load + URL hash ─────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '')
      if (['opportunity', 'moderate', 'high-risk'].includes(hash)) {
        setActiveTier(hash)
      }
    }
    fetchData()
  }, [fetchData])

  // ── Auto-refresh interval ───────────────────────────────────────────────────
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [autoRefresh, fetchData])

  // ── Seconds-ago counter ─────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // ── AG Grid init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agGridReady || !filteredLocks.length) return
    const container = document.getElementById('locksGrid')
    if (!container || typeof agGrid === 'undefined') return

    if (gridApi.current) {
      gridApi.current.setGridOption('rowData', filteredLocks)
      return
    }

    const options = {
      columnDefs: COLUMN_DEFS,
      rowData: filteredLocks,
      defaultColDef: {
        sortable: true,
        filter: true,
        resizable: true,
        floatingFilter: true,
      },
      pagination: true,
      paginationPageSize: 100,
      paginationPageSizeSelector: [50, 100, 200, 500],
      animateRows: true,
      enableCellTextSelection: true,
      getRowId: params => params.data.txHash,
      tooltipShowDelay: 300,
    }

    // eslint-disable-next-line no-undef
    gridApi.current = agGrid.createGrid(container, options)

    // Hide columns on mobile
    const handleResize = () => {
      if (!gridApi.current) return
      const isMobile = window.innerWidth < 768
      gridApi.current.setColumnsVisible(['devWallet', 'Sub-scores'], !isMobile)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [agGridReady, filteredLocks])

  // ── Update grid data when filters change ────────────────────────────────────
  useEffect(() => {
    if (gridApi.current) {
      gridApi.current.setGridOption('rowData', filteredLocks)
    }
  }, [filteredLocks])

  // ── Search ──────────────────────────────────────────────────────────────────
  const handleSearch = e => {
    if (gridApi.current) {
      gridApi.current.setGridOption('quickFilterText', e.target.value)
    }
  }

  // ── Tier tab click ──────────────────────────────────────────────────────────
  const handleTierClick = tier => {
    setActiveTier(tier)
    if (typeof window !== 'undefined') {
      window.location.hash = tier === 'all' ? '' : tier
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const CHAINS = ['ETH', 'BSC', 'MATIC', 'BASE']

  const tierTabClass = tab => {
    if (activeTier !== tab) return 'tier-tab'
    return `tier-tab active-${tab}`
  }

  return (
    <>
      <Head>
        <title>Hunt3r.exe — Live Lock Feed</title>
        <meta name="description" content="Real-time liquidity lock scoring feed across EVM chains" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css"
        />
      </Head>
      <Script
        src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"
        strategy="afterInteractive"
        onLoad={() => setAgGridReady(true)}
      />

      <div className="locks-page">
        {/* Header */}
        <header className="locks-header">
          <div>
            <div className="locks-title">🔒 Hunt3r.exe</div>
            <div className="locks-subtitle">Live lock scoring feed</div>
          </div>
        </header>

        {/* Stats Bar */}
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-label">Total Locks</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card opportunity">
            <div className="stat-label">🟢 Opportunities</div>
            <div className="stat-value">{stats.opportunity}</div>
          </div>
          <div className="stat-card moderate">
            <div className="stat-label">🟡 Moderate</div>
            <div className="stat-value">{stats.moderate}</div>
          </div>
          <div className="stat-card high-risk">
            <div className="stat-label">🔴 High Risk</div>
            <div className="stat-value">{stats.highRisk}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="controls-row">
          {/* Tier tabs */}
          <div className="tier-tabs">
            {[
              { id: 'all', label: 'All' },
              { id: 'opportunity', label: '🟢 Opportunities' },
              { id: 'moderate', label: '🟡 Moderate' },
              { id: 'high-risk', label: '🔴 High Risk' },
            ].map(t => (
              <button
                key={t.id}
                className={tierTabClass(t.id)}
                onClick={() => handleTierClick(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Chain pills */}
          <div className="chain-pills">
            <button
              className={`chain-pill${activeChain === 'all' ? ' active' : ''}`}
              onClick={() => setActiveChain('all')}
            >
              All
            </button>
            {CHAINS.map(c => (
              <button
                key={c}
                className={`chain-pill${activeChain === c ? ' active' : ''}`}
                onClick={() => setActiveChain(c)}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            className="search-input"
            type="text"
            placeholder="🔍 Search tokens, wallets..."
            onChange={handleSearch}
          />

          {/* Auto-refresh */}
          <div className="refresh-controls">
            <button
              className={`refresh-toggle ${autoRefresh ? 'active' : 'off'}`}
              onClick={() => setAutoRefresh(r => !r)}
            >
              {autoRefresh ? '⟳ Auto' : '⟳ Off'}
            </button>
            {lastUpdated && (
              <span className="last-updated">
                Updated {secondsAgo}s ago
              </span>
            )}
          </div>
        </div>

        {/* Error */}
        {error && <div className="error-banner">⚠️ {error}</div>}

        {/* Loading */}
        {loading && (
          <div className="loading-state">
            <div className="loading-spinner" />
            Loading locks...
          </div>
        )}

        {/* Grid */}
        <div className="grid-wrapper">
          <div
            id="locksGrid"
            className="ag-theme-alpine"
            style={{ height: 'calc(100vh - 300px)', width: '100%', minHeight: '400px' }}
          />
        </div>

        <footer className="locks-footer">
          Powered by Hunt3r.exe · Data updates every 60 seconds
        </footer>
      </div>
    </>
  )
}
