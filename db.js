const path = require('path');

let db;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  // initialize schema
  pool
    .query(
      `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        amount INTEGER,
        currency TEXT,
        seller_account_id TEXT,
        status TEXT,
        created_at BIGINT
      )`
    )
    .catch((err) => {
      console.error('Failed to initialize database', err);
      process.exit(1);
    });

  db = {
    async createOrder({ id, amount, currency, sellerAccountId, status, createdAt }) {
      await pool.query(
        'INSERT INTO orders (id, amount, currency, seller_account_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, amount, currency, sellerAccountId, status, createdAt]
      );
    },
    async getOrder(id) {
      const res = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      return res.rows[0];
    },
    async updateOrderStatus(id, status) {
      await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    },
  };
} else {
  const sqlite3 = require('sqlite3').verbose();
  const sqlite = new sqlite3.Database(path.join(__dirname, 'orders.db'));
  sqlite.serialize(() => {
    sqlite.run(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      amount INTEGER,
      currency TEXT,
      seller_account_id TEXT,
      status TEXT,
      created_at INTEGER
    )`);
  });

  db = {
    async createOrder({ id, amount, currency, sellerAccountId, status, createdAt }) {
      return new Promise((resolve, reject) => {
        sqlite.run(
          'INSERT INTO orders (id, amount, currency, seller_account_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, amount, currency, sellerAccountId, status, createdAt],
          (err) => (err ? reject(err) : resolve())
        );
      });
    },
    async getOrder(id) {
      return new Promise((resolve, reject) => {
        sqlite.get('SELECT * FROM orders WHERE id = ?', [id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    async updateOrderStatus(id, status) {
      return new Promise((resolve, reject) => {
        sqlite.run('UPDATE orders SET status = ? WHERE id = ?', [status, id], (err) =>
          err ? reject(err) : resolve()
        );
      });
    },
  };
}

module.exports = db;
