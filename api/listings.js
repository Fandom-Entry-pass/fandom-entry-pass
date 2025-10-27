// api/listings.js
export const config = { runtime: "nodejs" };

// Use CommonJS require to avoid ESM/CJS mismatches on Vercel
let Pool;
try {
  ({ Pool } = require("pg"));
} catch {
  // Fallback for ESM projects
  // eslint-disable-next-line no-undef
  ({ Pool } = await import("pg"));
}

const connectionString = process.env.DATABASE_URL || "";
const pool = connectionString
  ? new Pool({
      connectionString,
      // Works with Supabase and most managed Postgres
      ssl: { rejectUnauthorized: false },
    })
  : null;

// Create table/index if missing (runs once per cold start)
async function ensureTable() {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query(`
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
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_listings_updated_at
      ON listings(updated_at DESC);
    `);
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
    face: r.face == null ? null : Number(r.face),
    price: r.price == null ? null : Number(r.price),
    qty: r.qty == null ? null : Number(r.qty),
    remaining:
      r.remaining == null
        ? r.qty == null
          ? null
          : Number(r.qty)
        : Number(r.remaining),
    pay: r.pay,
    seller: r.seller,
    sellerEmail: r.seller_email,
    sellerPhone: r.seller_phone,
    sellerAccountId: r.seller_account_id,
    editToken: r.edit_token,
    manageCode: r.manage_code,
    createdAt: r.created_at?.toISOString?.() || r.created_at,
    updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    // ---------- Built-in diagnostics (no extra routes needed) ----------
    // /api/listings?ping=1           -> { ok:true, hasDbUrl:boolean }
    // /api/listings?diag=1           -> tries simple "select now()"
    // /api/listings?count=1          -> returns row count (if table exists)
    const q = req.query || {};
    if (q.ping) {
      return res.status(200).json({
        ok: true,
        hasDbUrl: Boolean(connectionString),
      });
    }
    if (q.diag) {
      if (!pool) {
        return res
          .status(500)
          .json({ ok: false, error: "DATABASE_URL not set" });
      }
      try {
        const r = await pool.query("select now() as now");
        return res.status(200).json({ ok: true, now: r.rows[0].now });
      } catch (e) {
        console.error("diag error:", e);
        return res
          .status(500)
          .json({ ok: false, error: e?.message || String(e) });
      }
    }
    if (q.count) {
      if (!pool) {
        return res
          .status(500)
          .json({ ok: false, error: "DATABASE_URL not set" });
      }
      try {
        await ensureTable();
        const r = await pool.query("select count(*)::int as c from listings");
        return res.status(200).json({ ok: true, count: r.rows[0].c });
      } catch (e) {
        console.error("count error:", e);
        return res
          .status(500)
          .json({ ok: false, error: e?.message || String(e) });
      }
    }
    // -------------------------------------------------------------------

    if (!pool) {
      return res
        .status(500)
        .json({ ok: false, error: "DATABASE_URL not set" });
    }

    await ensureTable();

    if (req.method === "GET") {
      const { rows } = await pool.query(
        "SELECT * FROM listings ORDER BY updated_at DESC LIMIT 500"
      );
      return res.status(200).json({ ok: true, items: rows.map(mapRow) });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (!body.id) return res.status(400).json({ ok: false, error: "Missing id" });
      if (!body.group)
        return res.status(400).json({ ok: false, error: "Missing group" });

      const sql = `
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
        body.createdAt ? new Date(body.createdAt) : null,
      ];

      const { rows } = await pool.query(sql, vals);
      return res.status(200).json({ ok: true, item: mapRow(rows[0]) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("api/listings error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Server error" });
  }
}
