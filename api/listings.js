// api/listings.js
import { Pool } from "pg";

export const config = { runtime: "nodejs" };

// Ensure your Supabase URL includes ?sslmode=require OR force it here:
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail fast with a readable error (shows up in Vercel logs)
  console.error("Missing DATABASE_URL");
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false } // works for Supabase
});

// One-time ensure the table exists (safe to run each cold start)
const ensureSQL = `
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  date_text TEXT,
  city TEXT,
  seat TEXT,
  face NUMERIC,
  price NUMERIC,
  qty INTEGER,
  remaining INTEGER,
  pay TEXT,
  seller TEXT,
  seller_email TEXT,
  seller_phone TEXT,
  seller_account_id TEXT,
  edit_token TEXT,
  manage_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- You can add an index for recent reads:
CREATE INDEX IF NOT EXISTS idx_listings_updated_at ON listings(updated_at DESC);
`;

async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query(ensureSQL);
  } finally {
    client.release();
  }
}

function mapRow(r) {
  return {
    id: r.id,
    group: r.group_name,
    date: r.date_text,
    city: r.city,
    seat: r.seat,
    face: Number(r.face ?? 0),
    price: Number(r.price ?? 0),
    qty: Number(r.qty ?? 0),
    remaining: r.remaining == null ? Number(r.qty ?? 0) : Number(r.remaining),
    pay: r.pay,
    seller: r.seller,
    sellerEmail: r.seller_email,
    sellerPhone: r.seller_phone,
    sellerAccountId: r.seller_account_id,
    editToken: r.edit_token,
    manageCode: r.manage_code,
    createdAt: r.created_at?.toISOString?.() || r.created_at,
    updatedAt: r.updated_at?.toISOString?.() || r.updated_at
  };
}

export default async function handler(req, res) {
  // no-cache
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensureTable();

    if (req.method === "GET") {
      const { rows } = await pool.query(
        `SELECT * FROM listings ORDER BY updated_at DESC LIMIT 500`
      );
      return res.status(200).json({ ok: true, items: rows.map(mapRow) });
    }

    if (req.method === "POST") {
      // Expect JSON from your frontend upsertListingRemote()
      const body = req.body || {};
      const now = new Date();

      // Basic validation
      if (!body.id) {
        return res.status(400).json({ ok: false, error: "Missing id" });
      }
      if (!body.group) {
        return res.status(400).json({ ok: false, error: "Missing group" });
      }

      // Upsert
      const q = `
        INSERT INTO listings (
          id, group_name, date_text, city, seat, face, price, qty, remaining, pay,
          seller, seller_email, seller_phone, seller_account_id, edit_token, manage_code,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,
          COALESCE($17, now()), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          group_name = EXCLUDED.group_name,
          date_text = EXCLUDED.date_text,
          city = EXCLUDED.city,
          seat = EXCLUDED.seat,
          face = EXCLUDED.face,
          price = EXCLUDED.price,
          qty = EXCLUDED.qty,
          remaining = EXCLUDED.remaining,
          pay = EXCLUDED.pay,
          seller = EXCLUDED.seller,
          seller_email = EXCLUDED.seller_email,
          seller_phone = EXCLUDED.seller_phone,
          seller_account_id = EXCLUDED.seller_account_id,
          edit_token = EXCLUDED.edit_token,
          manage_code = EXCLUDED.manage_code,
          updated_at = now()
        RETURNING *;
      `;

      const vals = [
        String(body.id),
        String(body.group || ""),
        body.date == null ? null : String(body.date),
        body.city == null ? null : String(body.city),
        body.seat == null ? null : String(body.seat),
        body.face == null ? null : Number(body.face),
        body.price == null ? null : Number(body.price),
        body.qty == null ? null : Number(body.qty),
        body.remaining == null ? null : Number(body.remaining),
        body.pay == null ? null : String(body.pay || ""),
        body.seller == null ? null : String(body.seller || ""),
        body.sellerEmail == null ? null : String(body.sellerEmail || ""),
        body.sellerPhone == null ? null : String(body.sellerPhone || ""),
        body.sellerAccountId == null ? null : String(body.sellerAccountId || ""),
        body.editToken == null ? null : String(body.editToken || ""),
        body.manageCode == null ? null : String(body.manageCode || ""),
        body.createdAt ? new Date(body.createdAt) : now
      ];

      const { rows } = await pool.query(q, vals);
      return res.status(200).json({ ok: true, item: mapRow(rows[0]) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("api/listings error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}


