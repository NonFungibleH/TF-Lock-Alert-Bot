// lib/database.js - Vercel Postgres version
const { Pool } = require('pg');

class LockAlertDatabase {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.POSTGRES_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        this.initializeDatabase();
    }

    async initializeDatabase() {
        try {
            const client = await this.pool.connect();
            
            // Create tables
            await client.query(`
                CREATE TABLE IF NOT EXISTS lock_alerts (
                    id SERIAL PRIMARY KEY,
                    transaction_id VARCHAR(255) UNIQUE NOT NULL,
                    lock_type VARCHAR(100) NOT NULL,
                    platform VARCHAR(100) NOT NULL,
                    chain_name VARCHAR(50) NOT NULL,
                    chain_id VARCHAR(10) NOT NULL,
                    contract_address VARCHAR(255),
                    event_name VARCHAR(100),
                    token_address VARCHAR(255),
                    token_symbol VARCHAR(50),
                    token_amount DECIMAL,
                    token_price_at_lock DECIMAL,
                    usd_value_at_lock DECIMAL,
                    current_token_price DECIMAL,
                    explorer_link TEXT NOT NULL,
                    lock_timestamp BIGINT NOT NULL,
                    created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
                );
            `);

            await client.query(`
                CREATE TABLE IF NOT EXISTS token_price_history (
                    id SERIAL PRIMARY KEY,
                    transaction_id VARCHAR(255) NOT NULL,
                    token_address VARCHAR(255),
                    token_symbol VARCHAR(50),
                    price DECIMAL NOT NULL,
                    timestamp_recorded BIGINT NOT NULL,
                    time_since_lock_minutes INTEGER NOT NULL,
                    price_change_percent DECIMAL,
                    FOREIGN KEY (transaction_id) REFERENCES lock_alerts (transaction_id)
                );
            `);

            // Create indexes
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_lock_alerts_timestamp ON lock_alerts(lock_timestamp);
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_lock_alerts_created_at ON lock_alerts(created_at);
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_price_history_tx_time ON token_price_history(transaction_id, time_since_lock_minutes);
            `);

            client.release();
            console.log('✅ Postgres database initialized successfully');
            
        } catch (error) {
            console.error('❌ Error initializing database:', error);
        }
    }

    async addLockAlert(webhookData) {
        try {
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

            const lockTimestamp = Math.floor(Date.now() / 1000);
            const chainId = this.getChainId(chain?.name || 'Unknown');

            const query = `
                INSERT INTO lock_alerts 
                (transaction_id, lock_type, platform, chain_name, chain_id, 
                 contract_address, event_name, token_address, token_symbol, 
                 token_amount, token_price_at_lock, usd_value_at_lock, 
                 explorer_link, lock_timestamp)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (transaction_id) DO UPDATE SET
                token_address = EXCLUDED.token_address,
                token_symbol = EXCLUDED.token_symbol,
                token_amount = EXCLUDED.token_amount,
                token_price_at_lock = EXCLUDED.token_price_at_lock,
                usd_value_at_lock = EXCLUDED.usd_value_at_lock
                RETURNING id;
            `;

            const values = [
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
            ];

            const client = await this.pool.connect();
            const result = await client.query(query, values);
            client.release();
            
            console.log(`✅ Lock saved to Postgres: ${txHash}`);
            return result.rows[0]?.id;
            
        } catch (error) {
            console.error('❌ Error inserting lock alert:', error);
            throw error;
        }
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

    async getAllLockAlerts(limit = 100) {
        try {
            const query = `
                SELECT la.*, 
                       STRING_AGG(
                           ph.time_since_lock_minutes::text || ':' || 
                           ROUND(ph.price_change_percent, 2)::text, ','
                       ) as price_changes
                FROM lock_alerts la
                LEFT JOIN token_price_history ph ON la.transaction_id = ph.transaction_id
                WHERE la.created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
                GROUP BY la.id
                ORDER BY la.created_at DESC
                LIMIT $1;
            `;

            const client = await this.pool.connect();
            const result = await client.query(query, [limit]);
            client.release();

            const processedRows = result.rows.map(row => ({
                ...row,
                priceChanges: this.parsePriceChanges(row.price_changes),
                created_at_formatted: new Date(row.created_at * 1000).toISOString()
            }));

            return processedRows;
            
        } catch (error) {
            console.error('❌ Error getting lock alerts:', error);
            return [];
        }
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

    async getDashboardStats() {
        try {
            const query = `
                SELECT 
                    COUNT(*) as total_locks,
                    COUNT(DISTINCT platform) as unique_platforms,
                    COUNT(DISTINCT chain_name) as unique_chains,
                    COALESCE(SUM(usd_value_at_lock), 0) as total_usd_locked,
                    COALESCE(AVG(usd_value_at_lock), 0) as avg_usd_locked
                FROM lock_alerts 
                WHERE created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days');
            `;

            const client = await this.pool.connect();
            const result = await client.query(query);
            client.release();

            return result.rows[0];
            
        } catch (error) {
            console.error('❌ Error getting dashboard stats:', error);
            return {
                total_locks: 0,
                unique_platforms: 0,
                unique_chains: 0,
                total_usd_locked: 0,
                avg_usd_locked: 0
            };
        }
    }

    async close() {
        await this.pool.end();
        console.log('Postgres connection pool closed');
    }
}

module.exports = LockAlertDatabase;
