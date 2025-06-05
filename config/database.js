require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
const config = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    // Additional options for robustness
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 2000, // How long to wait before timing out when connecting a new client
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

console.log('📊 Database configuration:', {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    max: config.max,
    ssl: config.ssl ? 'enabled' : 'disabled'
});

const pool = new Pool(config);

// Error handling
pool.on('error', (err, client) => {
    console.error('🚨 Unexpected error on idle client:', err);
});

// Connection testing function
async function testConnection() {
    let client;
    try {
        client = await pool.connect();
        console.log('✅ Successfully connected to the database');
        
        // Test query to ensure we can access the leads_dashboard schema
        const result = await client.query('SELECT COUNT(*) FROM leads_dashboard.lead_group');
        console.log('✅ Successfully queried lead_group table:', result.rows[0]);
        
    } catch (err) {
        console.error('❌ Database connection error:', err);
        throw err;
    } finally {
        if (client) {
            client.release();
        }
    }
}

// Enhanced query function with retries and error handling
async function query(text, params, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const start = Date.now();
            const res = await pool.query(text, params);
            const duration = Date.now() - start;
            
            if (duration > 1000) {
                console.warn(`🐢 Slow query (${duration}ms):`, { text, params });
            }
            
            return res;
        } catch (err) {
            console.error(`❌ Query error (attempt ${i + 1}/${retries}):`, err);
            
            if (err.code === 'ECONNREFUSED' || err.code === '57P01') {
                // Connection errors - wait and retry
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                continue;
            }
            
            if (i === retries - 1) {
                throw err;
            }
        }
    }
}

// Test the connection on startup
testConnection().catch(err => {
    console.error('❌ Initial database connection test failed:', err);
});

module.exports = {
    query,
    pool,
    testConnection
}; 