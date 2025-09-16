// db.js (ESM, serverless-safe)
//
// - Uses Postgres via DATABASE_URL when available
// - Falls back to an in-memory Map for local/dev without persistence
// - No SQLite or filesystem (not reliable on Vercel serverless)
// - Default export matches prior usage: import db from "./db.js"

let db = null;

async function initPostgres() {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
  });

  // Lazily ensure schema once per cold start
  let initPromise = null;
  const ensureInit = async () => {
    if (!initPromise) {
      initPromise = pool
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
          console.error("[db] Failed to initialize database", err);
          throw err;
        });
    }
    return initPromise;
  };

  return {
    async createOrder({ id, amount, currency, sellerAccountId, status, createdAt }) {
      await ensureInit();
      await pool.query(
        "INSERT INTO orders (id, amount, currency, seller_account_id, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        [id, amount, currency, sellerAccountId || null, status, createdAt]
      );
    },
    async getOrder(id) {
      await ensureInit();
      const res = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
      return res.rows[0] || null;
    },
    async updateOrderStatus(id, status) {
      await ensureInit();
      await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
    },
  };
}

function initMemory() {
  console.warn("[db] No DATABASE_URL set. Using in-memory store (non-persistent).");
  const mem = new Map();
  return {
    async createOrder(row) {
      mem.set(row.id, { ...row });
    },
    async getOrder(id) {
      return mem.get(id) || null;
    },
    async updateOrderStatus(id, status) {
      const row = mem.get(id);
      if (row) {
        row.status = status;
        mem.set(id, row);
      }
    },
  };
}

// Choose backend based on env
if (process.env.DATABASE_URL) {
  // Postgres (production-ready)
  db = await initPostgres();
} else {
  // In-memory (dev only; not persisted across serverless cold starts)
  db = initMemory();
}

export default db;

