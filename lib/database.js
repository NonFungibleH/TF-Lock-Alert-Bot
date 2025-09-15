const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

class LockAlertDatabase {
    constructor() {
        // Use a simple path that works with your existing structure
        this.dbPath = process.env.NODE_ENV === 'production' ? '/tmp/locks.db' : './locks.db';
        this.db = new sqlite3.Database(this.dbPath);
        this.initializeDatabase();
        this.startCleanupScheduler();
    }

    initializeDatabase() {
        const createTablesSQL = `
            CREATE TABLE IF NOT EXISTS lock_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT UNIQUE NOT NULL,
                lock_type TEXT NOT NULL,
                platform TEXT NOT NULL,
                chain_name TEXT NOT NULL,
                chain_id TEXT NOT NULL,
                contract_address TEXT,
                event_name TEXT,
                token_address TEXT,
                token_symbol TEXT,
                token_amount REAL,
                token_price_at_lock REAL,
                usd_value_at_lock REAL,
                current_token_price REAL,
                explorer_link TEXT NOT NULL,
                lock_timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            CREATE TABLE IF NOT EXISTS token_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id TEXT NOT NULL,
                token_address TEXT,
                token_symbol TEXT,
                price REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                time_since_lock_minutes INTEGER NOT NULL,
                price_change_percent REAL,
                FOREIGN KEY (transaction_id) REFERENCES lock_alerts (transaction_id)
            );

            CREATE INDEX IF NOT EXISTS idx_lock_alerts_timestamp ON lock_alerts(lock_timestamp);
            CREATE INDEX IF NOT EXISTS idx_lock_alerts_created_at ON lock_alerts(created_at);
        `;

        this.db.exec(createTablesSQL, (err) => {
            if (err) {
                console.error('Error creating tables:', err);
            } else {
                console.log('✅ Database initialized');
            }
        });
    }

    // Simple method to add lock alert from your existing webhook
    async addLockAlert(webhookData) {
        const {
            chain,
            type,
            source,
            explorerLink,
            txHash,
            contractAddress,
            eventName,
            tokenAddress,
            tokenSymbol,
            tokenAmount,
            tokenPriceAtLock,
            usdValueAtLock
        } = webhookData;

        return new Promise((resolve, reject) => {
            const sql = `
                INSERT OR REPLACE INTO lock_alerts 
                (transaction_id, lock_type, platform, chain_name, chain_id, 
                 contract_address, event_name, token_address, token_symbol, 
                 token_amount, token_price_at_lock, usd_value_at_lock, 
                 explorer_link, lock_timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const lockTimestamp = Math.floor(Date.now() / 1000);
            const chainId = this.getChainId(chain?.name || 'Unknown');

            this.db.run(sql, [
                txHash,
                type,
                source,
                chain?.name || 'Unknown',
                chainId,
                contractAddress,
                eventName,
                tokenAddress,
                tokenSymbol,
                tokenAmount,
                tokenPriceAtLock,
                usdValueAtLock,
                explorerLink,
                lockTimestamp
            ], function(err) {
                if (err) {
                    console.error('Error inserting lock alert:', err);
                    reject(err);
                } else {
                    console.log(`✅ Lock saved to dashboard: ${txHash}`);
                    resolve(this.lastID);
                }
            });
        });
    }

    getChainId(chainName) {
        const chainMap = {
            'Ethereum': '1',
            'BNB Chain': '56',
            'Polygon': '137',
            'Base': '8453'
        };
        return chainMap[chainName] || '0';
    }

    // Get all locks for dashboard
    async getAllLockAlerts(limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT la.*, 
                       GROUP_CONCAT(
                           ph.time_since_lock_minutes || ':' || 
                           ROUND(ph.price_change_percent, 2)
                       ) as price_changes
                FROM lock_alerts la
                LEFT JOIN token_price_history ph ON la.transaction_id = ph.transaction_id
                WHERE la.created_at > strftime('%s', 'now', '-7 days')
                GROUP BY la.id
                ORDER BY la.created_at DESC
                LIMIT ?
            `;

            this.db.all(sql, [limit], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const processedRows = rows.map(row => ({
                        ...row,
                        priceChanges: this.parsePriceChanges(row.price_changes),
                        created_at_formatted: new Date(row.created_at * 1000).toISOString()
                    }));
                    resolve(processedRows);
                }
            });
        });
    }

    parsePriceChanges(priceChangesStr) {
        if (!priceChangesStr) return {};
        
        const changes = {};
        priceChangesStr.split(',').forEach(change => {
            const [minutes, percent] = change.split(':');
            const timeLabel = this.minutesToLabel(parseInt(minutes));
            changes[timeLabel] = parseFloat(percent);
        });
        
        return changes;
    }

    minutesToLabel(minutes) {
        if (minutes === 30) return '30min';
        if (minutes === 60) return '1h';
        if (minutes === 360) return '6h';
        if (minutes === 720) return '12h';
        if (minutes === 1440) return '24h';
        return `${minutes}min`;
    }

    // Get dashboard statistics
    async getDashboardStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_locks,
                    COUNT(DISTINCT platform) as unique_platforms,
                    COUNT(DISTINCT chain_name) as unique_chains,
                    COALESCE(SUM(usd_value_at_lock), 0) as total_usd_locked,
                    COALESCE(AVG(usd_value_at_lock), 0) as avg_usd_locked
                FROM lock_alerts 
                WHERE created_at > strftime('%s', 'now', '-7 days')
            `;

            this.db.get(sql, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Clean up old records (7 days)
    startCleanupScheduler() {
        setInterval(() => {
            const sql = `DELETE FROM lock_alerts WHERE created_at < strftime('%s', 'now', '-7 days')`;
            this.db.run(sql, [], (err) => {
                if (err) {
                    console.error('Error cleaning up old records:', err);
                } else {
                    console.log('🧹 Cleaned up old lock records');
                }
            });
        }, 24 * 60 * 60 * 1000); // Run daily
    }

    close() {
        this.db.close();
    }
}

module.exports = LockAlertDatabase;
