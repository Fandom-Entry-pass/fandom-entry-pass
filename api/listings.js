// api/listings.js
import { Pool } from "pg";

export const config = { runtime: "nodejs" };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      group_name TEXT,
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
  `);
}

// util
function cleanNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok: false, error: "Missing DATABASE_URL" });
    }

    await ensureTable();

    if (req.method === "GET") {
      const { rows } = await pool.query(`
        SELECT
          id, group_name AS "group", date_text AS date, city, seat,
          face, price, qty, remaining, pay, seller,
          seller_email AS "sellerEmail",
          seller_phone AS "sellerPhone",
          seller_account_id AS "sellerAccountId",
          edit_token AS "editToken",
          manage_code AS "manageCode",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM listings
        ORDER BY updated_at DESC
      `);
      return res.status(200).json({ ok: true, items: rows });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const id = String(b.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

      const q = `
        INSERT INTO listings (
          id, group_name, date_text, city, seat,
          face, price, qty, remaining, pay, seller,
          seller_email, seller_phone, seller_account_id,
          edit_token, manage_code, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          group_name=$2, date_text=$3, city=$4, seat=$5,
          face=$6, price=$7, qty=$8, remaining=$9, pay=$10,
          seller=$11, seller_email=$12, seller_phone=$13,
          seller_account_id=$14, edit_token=$15, manage_code=$16,
          updated_at=now()
        RETURNING
          id, group_name AS "group", date_text AS date, city, seat,
          face, price, qty, remaining, pay, seller,
          seller_email AS "sellerEmail",
          seller_phone AS "sellerPhone",
          seller_account_id AS "sellerAccountId",
          edit_token AS "editToken",
          manage_code AS "manageCode",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `;
      const vals = [
        id, String(b.group || ""), String(b.date || ""), String(b.city || ""), String(b.seat || ""),
        cleanNumber(b.face), cleanNumber(b.price), b.qty || 1, b.remaining || b.qty || 1, String(b.pay || ""),
        String(b.seller || ""), String(b.sellerEmail || "").toLowerCase(), String(b.sellerPhone || ""),
        String(b.sellerAccountId || ""), String(b.editToken || ""), String(b.manageCode || "")
      ];
      const { rows } = await pool.query(q, vals);
      return res.status(200).json({ ok: true, item: rows[0] });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("listings error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

