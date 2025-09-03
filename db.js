const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'orders.db'));

// Initialize schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    amount INTEGER,
    currency TEXT,
    seller_account_id TEXT,
    status TEXT,
    created_at INTEGER
  )`);
});

module.exports = db;
