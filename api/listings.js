// api/listings.js
import pg from "pg";
export const config = { runtime: "nodejs" };

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id                uuid PRIMARY KEY,
      group_name        text NOT NULL,
      date_text         text,
      city              text,
      seat              text,
      face_cents        integer NOT NULL,
      price_cents       integer NOT NULL,
      qty               integer NOT NULL,
      remaining         integer NOT NULL,
      pay               text,
      seller            text,
      seller_email      text,
      seller_phone      text,
      seller_account_id text,
      edit_token        text,
      manage_code       text,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_listings_seller_email ON listings (lower(seller_email));
  `);
}

const toCents  = n => Math.round(Number(n || 0) * 100);
const fromCents = c => Math.round(Number(c || 0)) / 100;

const rowToClient = r => ({
  id: r.id,
  group: r.group_name,
  date: r.date_text,
  city: r.city,
  seat: r.seat,
  face: fromCents(r.face_cents),
  price: fromCents(r.price_cents),
  qty: r.qty,
  remaining: r.remaining,
  pay: r.pay,
  seller: r.seller,
  sellerEmail: r.seller_email,
  sellerPhone: r.seller_phone,
  sellerAccountId: r.seller_account_id,
  editToken: r.edit_token,
  manageCode: r.manage_code,
  createdAt: r.created_at,
  updatedAt: r.updated_at
});

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({ ok:false, error:"Missing DATABASE_URL" });
    }
    await ensureTable();

    if (req.method === "GET") {
      const r = await pool.query(`SELECT * FROM listings ORDER BY updated_at DESC LIMIT 500`);
      return res.status(200).json({ ok:true, items: r.rows.map(rowToClient) });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ ok:false, error:"Missing id" });

      const vals = [
        b.id,
        String(b.group || ""),
        String(b.date || ""),
        String(b.city || ""),
        String(b.seat || ""),
        toCents(b.face),
        toCents(b.price),
        Number(b.qty || 1),
        Number(b.remaining ?? b.qty ?? 1),
        String(b.pay || ""),
        String(b.seller || ""),
        String(b.sellerEmail || ""),
        String(b.sellerPhone || ""),
        String(b.sellerAccountId || ""),
        String(b.editToken || ""),
        String(b.manageCode || "")
      ];

      const sql = `
        INSERT INTO listings (
          id, group_name, date_text, city, seat, face_cents, price_cents,
          qty, remaining, pay, seller, seller_email, seller_phone,
          seller_account_id, edit_token, manage_code
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        )
        ON CONFLICT (id) DO UPDATE SET
          group_name=$2, date_text=$3, city=$4, seat=$5,
          face_cents=$6, price_cents=$7, qty=$8, remaining=$9, pay=$10,
          seller=$11, seller_email=$12, seller_phone=$13, seller_account_id=$14,
          edit_token=$15, manage_code=$16, updated_at=now()
        RETURNING *;
      `;
      const r = await pool.query(sql, vals);
      return res.status(200).json({ ok:true, item: rowToClient(r.rows[0]) });
    }

    res.setHeader("Allow","GET, POST");
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  } catch (e) {
    console.error("listings api error:", e);
    return res.status(500).json({ ok:false, error:"Server error" });
  }
}
