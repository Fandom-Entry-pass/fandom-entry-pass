const { Pool } = require('pg');

// Initialize a single connection pool for serverless functions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Allow connecting to environments like Supabase that require SSL
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
