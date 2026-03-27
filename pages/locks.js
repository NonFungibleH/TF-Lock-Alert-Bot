import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import Script from 'next/script'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(val) {
  if (!val) return '—'
  // created_at is stored as BIGINT (Unix epoch seconds)
  const ts = typeof val === 'number' || /^\d+$/.test(String(val))
    ? parseInt(val) * 1000
    : new Date(val).getTime()
  if (isNaN(ts)) return '—'
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
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
  if (s === 'Positive') return '😊 Pos'
  if (s === 'Negative') return '😟 Neg'
  return '😐 Neu'
}

function truncAddr(a) {
  if (!a || a.length < 10) return a || '—'
  return a.slice(0, 6) + '…' + a.slice(-4)
}

function fmtUsd(v) {
  if (v == null) return '—'
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M'
  if (v >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'K'
  return '$' + Number(v).toFixed(2)
}

function isoDate(d) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 16)
}

// ─── Column defs ──────────────────────────────────────────────────────────────

const COLS = [
  {
    headerName: 'Time', field: 'time', width: 110, sort: 'desc',
    cellRenderer: p => relativeTime(p.value),
    tooltipValueGetter: p => {
      if (!p.value) return ''
      const ts = /^\d+$/.test(String(p.value)) ? parseInt(p.value) * 1000 : new Date(p.value).getTime()
      return isNaN(ts) ? '' : new Date(ts).toLocaleString()
    },
  },
  {
    headerName: 'Score', field: 'score', width: 85,
    cellRenderer: p => scoreBadge(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Tier', field: 'tier', width: 115,
    cellRenderer: p => tierBadge(p.value),
    filter: true,
  },
  { headerName: 'Token', field: 'token', width: 95, filter: true },
  { headerName: 'Chain', field: 'chain', width: 80, filter: true },
  {
    headerName: 'Locked %', field: 'lockedPercent', width: 100,
    valueFormatter: p => p.value != null ? p.value.toFixed(1) + '%' : '—',
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'USD Locked', field: 'nativeLockedUsd', width: 115,
    valueFormatter: p => fmtUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Mkt Cap', field: 'marketCap', width: 105,
    valueFormatter: p => fmtUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Liquidity', field: 'liquidity', width: 100,
    valueFormatter: p => fmtUsd(p.value),
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: 'Twitter', field: 'twitterHandle', width: 115,
    cellRenderer: p => p.value
      ? `<a href="https://twitter.com/${p.value.replace('@','')}" target="_blank" style="color:#00e5ff;text-decoration:none">${p.value}</a>`
      : '—',
    filter: true,
  },
  {
    headerName: 'Sentiment', field: 'sentiment', width: 100,
    cellRenderer: p => sentimentEmoji(p.value),
    filter: true,
  },
  {
    headerName: 'Dev Wallet', field: 'devWallet', width: 120,
    cellRenderer: p => p.value ? `<span style="font-family:var(--font-mono);font-size:11px">${truncAddr(p.value)}</span>` : '—',
    filter: true,
  },
  {
    headerName: 'Sub-scores', width: 155, sortable: false, filter: false,
    valueGetter: p => p.data,
    cellRenderer: p => {
      const d = p.value
      const f = v => v != null ? v : '—'
      return `<span style="font-size:11px;color:rgba(180,210,255,0.5);font-family:'Space Mono',monospace">L:${f(d.lockScore)} S:${f(d.socialScore)} O:${f(d.onchainScore)} M:${f(d.marketScore)}</span>`
    },
  },
  {
    headerName: 'TX', field: 'explorerLink', width: 70, sortable: false, filter: false,
    cellRenderer: p => p.value
      ? `<a href="${p.value}" target="_blank" style="color:#00e5ff;text-decoration:none;font-size:12px">View →</a>`
      : '—',
  },
]

// ─── Date preset helpers ──────────────────────────────────────────────────────

const DATE_PRESETS = [
  { id: '24h',   label: '24h',   hours: 24 },
  { id: '7d',    label: '7d',    hours: 24 * 7 },
  { id: '30d',   label: '30d',   hours: 24 * 30 },
  { id: 'all',   label: 'All',   hours: null },
]

function presetToRange(preset) {
  if (!preset || preset === 'all') return { from: null, to: null }
  const hours = DATE_PRESETS.find(p => p.id === preset)?.hours
  if (!hours) return { from: null, to: null }
  const from = new Date(Date.now() - hours * 3600 * 1000)
  return { from: from.toISOString(), to: null }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LocksPage() {
  const [allLocks, setAllLocks] = useState([])
  const [stats, setStats] = useState({ total: 0, opportunity: 0, moderate: 0, highRisk: 0, chains: [] })
  const [activeTier, setActiveTier] = useState('all')
  const [activeChain, setActiveChain] = useState('all')
  const [datePreset, setDatePreset] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [agGridReady, setAgGridReady] = useState(false)
  const gridApi = useRef(null)
  const prevHashes = useRef(new Set())

  // Build API URL from current filters
  const buildApiUrl = useCallback(() => {
    const params = new URLSearchParams({ limit: '500' })
    if (activeTier !== 'all') params.set('tier', activeTier)
    if (activeChain !== 'all') params.set('chain', activeChain.toLowerCase())

    if (datePreset !== 'all' && datePreset !== 'custom') {
      const { from } = presetToRange(datePreset)
      if (from) params.set('from', from)
    } else if (datePreset === 'custom') {
      if (customFrom) params.set('from', new Date(customFrom).toISOString())
      if (customTo)   params.set('to',   new Date(customTo).toISOString())
    }

    return `/api/dashboard/locks?${params.toString()}`
  }, [activeTier, activeChain, datePreset, customFrom, customTo])

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const url = buildApiUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data = await res.json()
      setAllLocks(data.locks || [])
      setStats(data.stats || { total: 0, opportunity: 0, moderate: 0, highRisk: 0, chains: [] })
      setLastUpdated(new Date())
      setSecondsAgo(0)
      setError(null)
      prevHashes.current = new Set((data.locks || []).map(l => l.txHash))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [buildApiUrl])

  // Initial load
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : ''
    if (['opportunity', 'moderate', 'high-risk'].includes(hash)) setActiveTier(hash)
    fetchData()
  }, [fetchData])

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(fetchData, 60000)
    return () => clearInterval(t)
  }, [autoRefresh, fetchData])

  // Seconds-ago ticker
  useEffect(() => {
    const t = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Re-fetch when filters change
  useEffect(() => {
    if (!loading) fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTier, activeChain, datePreset, customFrom, customTo])

  // AG Grid init / update
  useEffect(() => {
    if (!agGridReady) return
    const container = document.getElementById('locksGrid')
    if (!container || typeof agGrid === 'undefined') return

    if (gridApi.current) {
      gridApi.current.setGridOption('rowData', allLocks)
      return
    }

    // eslint-disable-next-line no-undef
    gridApi.current = agGrid.createGrid(container, {
      columnDefs: COLS,
      rowData: allLocks,
      defaultColDef: { sortable: true, filter: true, resizable: true, floatingFilter: true },
      pagination: true,
      paginationPageSize: 100,
      paginationPageSizeSelector: [50, 100, 200, 500],
      animateRows: true,
      enableCellTextSelection: true,
      getRowId: p => p.data.txHash || String(Math.random()),
      tooltipShowDelay: 300,
    })

    const handleResize = () => {
      if (!gridApi.current) return
      gridApi.current.setColumnsVisible(['devWallet', 'Sub-scores'], window.innerWidth >= 1024)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [agGridReady, allLocks])

  useEffect(() => {
    if (gridApi.current) gridApi.current.setGridOption('rowData', allLocks)
  }, [allLocks])

  const handleSearch = e => {
    if (gridApi.current) gridApi.current.setGridOption('quickFilterText', e.target.value)
  }

  const handleTierClick = tier => {
    setActiveTier(tier)
    if (typeof window !== 'undefined') window.location.hash = tier === 'all' ? '' : tier
  }

  const CHAINS = ['ETH', 'BSC', 'MATIC', 'BASE']

  return (
    <>
      <Head>
        <title>Hunt3r.exe — Live Lock Feed</title>
        <meta name="description" content="Real-time liquidity lock scoring across EVM chains" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-grid.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/styles/ag-theme-alpine.css" />
      </Head>
      <Script
        src="https://cdn.jsdelivr.net/npm/ag-grid-community@31.0.0/dist/ag-grid-community.min.js"
        strategy="afterInteractive"
        onLoad={() => setAgGridReady(true)}
      />

      <div className="locks-page">
        <div className="content-wrapper">

          {/* Header */}
          <header className="locks-header">
            <div className="header-left">
              <div className="locks-title">🔒 Hunt3r.exe</div>
              <div className="locks-subtitle">Live Liquidity Lock Intelligence</div>
            </div>
            <div className="header-right">
              {lastUpdated && (
                <span className="last-updated">{secondsAgo}s ago</span>
              )}
              <button
                className={`refresh-toggle ${autoRefresh ? 'active' : 'off'}`}
                onClick={() => setAutoRefresh(r => !r)}
              >
                {autoRefresh ? '⟳ AUTO' : '⟳ OFF'}
              </button>
            </div>
          </header>

          {/* Stats */}
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
          <div className="controls-section">
            {/* Tier tabs */}
            <div className="control-group">
              {[
                { id: 'all',         label: 'All' },
                { id: 'opportunity', label: '🟢 Opportunities' },
                { id: 'moderate',    label: '🟡 Moderate' },
                { id: 'high-risk',   label: '🔴 High Risk' },
              ].map(t => (
                <button
                  key={t.id}
                  className={`tier-tab${activeTier === t.id ? ` active-${t.id}` : ''}`}
                  onClick={() => handleTierClick(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="control-divider" />

            {/* Chain pills */}
            <div className="control-group">
              {['All', ...CHAINS].map(c => (
                <button
                  key={c}
                  className={`chain-pill${activeChain === (c === 'All' ? 'all' : c) ? ' active' : ''}`}
                  onClick={() => setActiveChain(c === 'All' ? 'all' : c)}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="control-divider" />

            {/* Date presets */}
            <div className="control-group">
              <span className="date-label">Range:</span>
              {DATE_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`date-preset${datePreset === p.id ? ' active' : ''}`}
                  onClick={() => setDatePreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`date-preset${datePreset === 'custom' ? ' active' : ''}`}
                onClick={() => setDatePreset('custom')}
              >
                Custom
              </button>
            </div>

            {/* Custom date inputs */}
            {datePreset === 'custom' && (
              <div className="control-group">
                <input
                  type="datetime-local"
                  className="date-input"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  placeholder="From"
                />
                <span className="date-label">→</span>
                <input
                  type="datetime-local"
                  className="date-input"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  placeholder="To"
                />
              </div>
            )}

            {/* Search */}
            <input
              className="search-input"
              type="text"
              placeholder="🔍  Search tokens, wallets, chains..."
              onChange={handleSearch}
            />

          </div>

          {/* Error */}
          {error && <div className="error-banner">⚠️ {error}</div>}

          {/* Loading */}
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner" />
              Initialising feed...
            </div>
          )}

          {/* Grid */}
          <div className="grid-wrapper">
            <div
              id="locksGrid"
              className="ag-theme-alpine-dark"
              style={{ height: 'calc(100vh - 340px)', width: '100%', minHeight: '400px' }}
            />
          </div>

          <footer className="locks-footer">
            Hunt3r.exe · Real-time EVM lock intelligence · Auto-refreshes every 60s
          </footer>

        </div>
      </div>
    </>
  )
}
