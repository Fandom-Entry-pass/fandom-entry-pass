// api/listings.js
import { Pool } from "pg";

export const config = { runtime: "nodejs" };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Optional: require SSL in hosted DBs
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

async function ensureTable() {
  // very light “create if not exists”
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id            TEXT PRIMARY KEY,
      group_name    TEXT,
      date_text     TEXT,
      city          TEXT,
      seat          TEXT,
      face          NUMERIC,
      price         NUMERIC,
      qty           INTEGER,
      remaining     INTEGER,
      pay           TEXT,
      seller        TEXT,
      seller_email  TEXT,
      seller_phone  TEXT,
      seller_account_id TEXT,
      edit_token    TEXT,
      manage_code   TEXT,
      created_at    TIMESTAMPTZ DEFAULT now(),
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS listings_updated_at_idx ON listings(updated_at DESC);
  `);
}

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
      const { rows } = await pool.query(
        `SELECT
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
         ORDER BY updated_at DESC, created_at DESC`
      );
      return res.status(200).json({ ok: true, items: rows });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      // normalize
      const item = {
        id: String(b.id || "").trim(),
        group: String(b.group || "").trim(),
        date: String(b.date || "").trim(),
        city: String(b.city || "").trim(),
        seat: String(b.seat || "").trim(),
        face: cleanNumber(b.face),
        price: cleanNumber(b.price),
        qty: Math.max(1, parseInt(b.qty ?? 1, 10)),
        remaining: Math.max(0, parseInt(b.remaining ?? b.qty ?? 1, 10)),
        pay: String(b.pay || "").trim(),
        seller: String(b.seller || "Seller").trim(),
        sellerEmail: String(b.sellerEmail || "").trim().toLowerCase(),
        sellerPhone: String(b.sellerPhone || "").trim(),
        sellerAccountId: String(b.sellerAccountId || "").trim(),
        editToken: String(b.editToken || "").trim(),
        manageCode: String(b.manageCode || "").trim(),
      };

      if (!item.id) return res.status(400).json({ ok: false, error: "Missing id" });

      const q = `
        INSERT INTO listings (
          id, group_name, date_text, city, seat,
          face, price, qty, remaining, pay, seller,
          seller_email, seller_phone, seller_account_id,
          edit_token, manage_code, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,
          $12,$13,$14,
          $15,$16, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          group_name = EXCLUDED.group_name,
          date_text  = EXCLUDED.date_text,
          city       = EXCLUDED.city,
          seat       = EXCLUDED.seat,
          face       = EXCLUDED.face,
          price      = EXCLUDED.price,
          qty        = EXCLUDED.qty,
          remaining  = EXCLUDED.remaining,
          pay        = EXCLUDED.pay,
          seller     = EXCLUDED.seller,
          seller_email = EXCLUDED.seller_email,
          seller_phone = EXCLUDED.seller_phone,
          seller_account_id = EXCLUDED.seller_account_id,
          edit_token = EXCLUDED.edit_token,
          manage_code = EXCLUDED.manage_code,
          updated_at = now()
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
        item.id, item.group, item.date, item.city, item.seat,
        item.face, item.price, item.qty, item.remaining, item.pay, item.seller,
        item.sellerEmail, item.sellerPhone, item.sellerAccountId,
        item.editToken, item.manageCode
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

