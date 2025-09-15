// api/locks.js - Dashboard API endpoint
const LockAlertDatabase = require('../lib/database');

let db;

// Initialize database connection
function getDatabase() {
    if (!db) {
        db = new LockAlertDatabase();
    }
    return db;
}

module.exports = async (req, res) => {
    // Enable CORS for dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const database = getDatabase();

    try {
        if (req.method === 'POST') {
            // Handle incoming lock alerts from your existing webhook
            console.log('📨 Dashboard received lock alert:', JSON.stringify(req.body, null, 2));
            
            const lockId = await database.addLockAlert(req.body);
            
            return res.status(200).json({ 
                success: true, 
                lockId,
                message: 'Lock alert saved to dashboard' 
            });
        }
        
        else if (req.method === 'GET') {
            const { action, limit = 100 } = req.query;
            
            if (action === 'stats') {
                // Return dashboard statistics
                const stats = await database.getDashboardStats();
                return res.status(200).json(stats);
            }
            
            else {
                // Return all lock alerts for dashboard
                const locks = await database.getAllLockAlerts(parseInt(limit));
                return res.status(200).json(locks);
            }
        }
        
        else {
            return res.status(405).json({ error: 'Method not allowed' });
        }
        
    } catch (error) {
        console.error('Dashboard API Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
};
