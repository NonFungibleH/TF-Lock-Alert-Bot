import { useState, useEffect } from 'react'

export default function Dashboard() { 
  const [locks, setLocks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchLocks()
  }, [])

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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            Lock Performance Dashboard
          </h1>
          <p className="text-gray-400 text-lg">
            Real-time tracking of liquidity locks across Web3 platforms
          </p>
        </div>

        <div className="bg-black/30 backdrop-blur-sm border border-purple-500/20 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-purple-900/30">
              <tr>
                <th className="px-6 py-4 text-left text-purple-300 font-semibold">Lock Type</th>
                <th className="px-6 py-4 text-left text-purple-300 font-semibold">Chain</th>
                <th className="px-6 py-4 text-left text-purple-300 font-semibold">Platform</th>
                <th className="px-6 py-4 text-left text-purple-300 font-semibold">Transaction</th>
                <th className="px-6 py-4 text-left text-purple-300 font-semibold">USD Value</th>
              </tr>
            </thead>
            <tbody>
              {locks.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-gray-400">
                    No locks found
                  </td>
                </tr>
              ) : (
                locks.map((lock, index) => (
                  <tr key={index} className="border-t border-purple-500/10 hover:bg-purple-500/5">
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300">
                        {lock.type || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span>{lock.chain?.name || 'Unknown'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-purple-400 font-medium">{lock.source || 'Unknown'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-purple-400 font-mono text-sm">
                        {lock.txHash ? lock.txHash.substring(0, 8) + '...' : 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-green-400 font-semibold">
                        ${lock.usdValue?.toLocaleString() || 'N/A'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-8 text-center text-gray-400">
          <p>Showing {locks.length} locks</p>
        </div>
      </div>
    </div>
  )
}
