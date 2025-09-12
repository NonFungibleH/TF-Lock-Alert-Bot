// pages/index.js
import { useState, useEffect } from 'react'

export default function Dashboard() {
  const [locks, setLocks] = useState([])
  const [filteredLocks, setFilteredLocks] = useState([])
  const [filters, setFilters] = useState({
    lockType: '',
    chain: '',
    platform: '',
    minValue: '',
    tokenSearch: ''
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLocks()
    // Set up real-time updates every 30 seconds
    const interval = setInterval(fetchLocks, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    applyFilters()
  }, [locks, filters])

  const fetchLocks = async () => {
    try {
      const response = await fetch('/api/locks')
      const data = await response.json()
      setLocks(data)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching locks:', error)
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = locks

    if (filters.lockType) {
      filtered = filtered.filter(lock => 
        lock.type.toLowerCase().includes(filters.lockType.toLowerCase())
      )
    }
    if (filters.chain) {
      filtered = filtered.filter(lock => 
        lock.chain.name.toLowerCase().includes(filters.chain.toLowerCase())
      )
    }
    if (filters.platform) {
      filtered = filtered.filter(lock => 
        lock.source.toLowerCase().includes(filters.platform.toLowerCase())
      )
    }
    if (filters.minValue) {
      filtered = filtered.filter(lock => 
        (lock.usdValue || 0) >= parseFloat(filters.minValue)
      )
    }
    if (filters.tokenSearch) {
      filtered = filtered.filter(lock => 
        (lock.token1 || '').toLowerCase().includes(filters.tokenSearch.toLowerCase()) ||
        (lock.token2 || '').toLowerCase().includes(filters.tokenSearch.toLowerCase())
      )
    }

    setFilteredLocks(filtered)
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const formatUSD = (amount) => {
    if (!amount) return 'N/A'
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  const formatPrice = (price) => {
    if (!price) return 'N/A'
    if (price < 0.001) {
      return price.toExponential(3)
    }
    return `$${price.toFixed(6)}`
  }

  const calculatePerformance = (lockPrice, currentPrice) => {
    if (!lockPrice || !currentPrice) return null
    return ((currentPrice - lockPrice) / lockPrice * 100)
  }

  const getChainColor = (chainName) => {
    const colors = {
      'Ethereum': 'bg-blue-500',
      'BNB Chain': 'bg-yellow-500',
      'Polygon': 'bg-purple-500',
      'Base': 'bg-blue-400'
    }
    return colors[chainName] || 'bg-gray-500'
  }

  const getTypeColor = (type) => {
    if (type.includes('Token')) return 'bg-green-500/20 text-green-300'
    if (type.includes('Liquidity')) return 'bg-blue-500/20 text-blue-300'
    return 'bg-purple-500/20 text-purple-300'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading lock data...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            Lock Performance Dashboard
          </h1>
          <p className="text-gray-400 text-lg">
            Real-time tracking of liquidity locks across Web3 platforms
          </p>
        </div>

        {/* Filters */}
        <div className="bg-black/30 backdrop-blur-sm border border-purple-500/20 rounded-xl p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-purple-300 text-sm font-medium mb-2">Lock Type</label>
              <select
                value={filters.lockType}
                onChange={(e) => handleFilterChange('lockType', e.target.value)}
                className="w-full bg-black/50 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:border-purple-400 focus:outline-none"
              >
                <option value="">All Types</option>
                <option value="V2 Token">V2 Token</option>
                <option value="V3 Token">V3 Token</option>
                <option value="V4 Token">V4 Token</option>
                <option value="Liquidity">Liquidity</option>
              </select>
            </div>

            <div>
              <label className="block text-purple-300 text-sm font-medium mb-2">Chain</label>
              <select
                value={filters.chain}
                onChange={(e) => handleFilterChange('chain', e.target.value)}
                className="w-full bg-black/50 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:border-purple-400 focus:outline-none"
              >
                <option value="">All Chains</option>
                <option value="Ethereum">Ethereum</option>
                <option value="BNB Chain">BNB Chain</option>
                <option value="Polygon">Polygon</option>
                <option value="Base">Base</option>
              </select>
            </div>

            <div>
              <label className="block text-purple-300 text-sm font-medium mb-2">Platform</label>
              <select
                value={filters.platform}
                onChange={(e) => handleFilterChange('platform', e.target.value)}
                className="w-full bg-black/50 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:border-purple-400 focus:outline-none"
              >
                <option value="">All Platforms</option>
                <option value="Team Finance">Team Finance</option>
                <option value="UNCX">UNCX</option>
                <option value="GoPlus">GoPlus</option>
                <option value="PBTC">PBTC</option>
              </select>
            </div>

            <div>
              <label className="block text-purple-300 text-sm font-medium mb-2">Min USD Value</label>
              <input
                type="number"
                value={filters.minValue}
                onChange={(e) => handleFilterChange('minValue', e.target.value)}
                placeholder="0"
                className="w-full bg-black/50 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:border-purple-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-purple-300 text-sm font-medium mb-2">Token Search</label>
              <input
                type="text"
                value={filters.tokenSearch}
                onChange={(e) => handleFilterChange('tokenSearch', e.target.value)}
                placeholder="Search tokens..."
                className="w-full bg-black/50 border border-purple-500/30 rounded-lg px-3 py-2 text-white focus:border-purple-400 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-black/30 backdrop-blur-sm border border-purple-500/20 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-purple-900/30">
                <tr>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Lock Type</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Chain</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Platform</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Transaction</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Token Pair</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">USD Value</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Lock Price</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Current Price</th>
                  <th className="px-6 py-4 text-left text-purple-300 font-semibold">Performance</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocks.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-8 text-center text-gray-400">
                      No locks found matching your filters
                    </td>
                  </tr>
                ) : (
                  filteredLocks.map((lock, index) => {
                    const performance = calculatePerformance(lock.lockPrice, lock.currentPrice)
                    return (
                      <tr key={index} className="border-t border-purple-500/10 hover:bg-purple-500/5">
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${getTypeColor(lock.type)}`}>
                            {lock.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getChainColor(lock.chain.name)}`}></div>
                            <span>{lock.chain.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-purple-400 font-medium">{lock.source}</span>
                        </td>
                        <td className="px-6 py-4">
                          <a
                            href={lock.explorerLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 font-mono text-sm"
                          >
                            {lock.txHash?.slice(0, 6)}...{lock.txHash?.slice(-4)}
                          </a>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full"></div>
                            <span>{lock.token1 || 'TOKEN'}/{lock.token2 || 'USDT'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-green-400 font-semibold">{formatUSD(lock.usdValue)}</span>
                        </td>
                        <td className="px-6 py-4 font-mono">
                          {formatPrice(lock.lockPrice)}
                        </td>
                        <td className="px-6 py-4 font-mono">
                          {formatPrice(lock.currentPrice)}
                        </td>
                        <td className="px-6 py-4">
                          {performance !== null ? (
                            <span className={`font-semibold ${performance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {performance >= 0 ? '+' : ''}{performance.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-gray-500">N/A</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stats Footer */}
        <div className="mt-8 text-center text-gray-400">
          <p>Showing {filteredLocks.length} of {locks.length} locks</p>
          <p className="text-sm">Last updated: {new Date().toLocaleTimeString()}</p>
        </div>
      </div>
    </div>
  )
}
