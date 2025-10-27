// api/listings.js
export const config = { runtime: "nodejs" };

// ✅ Prefer IPv4 first to avoid IPv6-only DNS issues on some serverless hosts
try { require("node:dns").setDefaultResultOrder?.("ipv4first"); } catch {}

/* pg import (CJS first, ESM fallback) */
let Pool;
try { ({ Pool } = require("pg")); }
catch { ({ Pool } = await import("pg")); }

/* -----------------------------
   Load + sanitize DATABASE_URL
------------------------------*/
function cleanDbUrl(input) {
  if (!input) return "";
  let out = String(input)
    .replace(/^['"]+|['"]+$/g, "")               // strip quotes
    .replace(/\r?\n/g, "")                       // remove newlines
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, "") // zero-width chars
    .trim()
    .replace(/^postgres:\/\//i, "postgresql://"); // normalize scheme
  // Ensure Supabase SSL requirement
  if (!/\bsslmode=/.test(out)) {
    out += (out.includes("?") ? "&" : "?") + "sslmode=require";
  }
  return out;
}

// Support both env names (some dashboards use lowercase)
const RAW_URL_INPUT =
  process.env.DATABASE_URL ??
  process.env.database_url ??
  "";

const DATABASE_URL = cleanDbUrl(RAW_URL_INPUT);

/* Parse early (for host/port/user/pass) */
let parsedUrl = null;
try { if (DATABASE_URL) parsedUrl = new URL(DATABASE_URL); } catch {}

/* -----------------------------
   IPv4 resolution + Pool factory
------------------------------*/
let _poolPromise = null;

async function resolveIPv4(hostname) {
  try {
    const dns = (await import("node:dns")).promises;
    // Try lookup (system resolver), force IPv4
    const { address } = await dns.lookup(hostname, { family: 4 });
    return address;
  } catch {
    try {
      // Fallback: resolve A records directly
      const dns = (await import("node:dns")).promises;
      const addrs = await dns.resolve4(hostname);
      return Array.isArray(addrs) && addrs[0] ? addrs[0] : null;
    } catch {
      return null; // last resort: use hostname
    }
  }
}

async function getPool() {
  if (!DATABASE_URL || !parsedUrl) return null;

  // Pull fields from URL
  const user = decodeURIComponent(parsedUrl.username || "");
  const password = decodeURIComponent(parsedUrl.password || "");
  const database = (parsedUrl.pathname || "").replace(/^\//, "") || "postgres";
  const port = parsedUrl.port ? Number(parsedUrl.port) : 5432;
  const hostname = parsedUrl.hostname;

  // Resolve to IPv4 to dodge AAAA-only environments
  const ipv4 = await resolveIPv4(hostname);

  return new Pool({
    host: ipv4 || hostname,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  });
}

async function ensurePool() {
  if (!_poolPromise) _poolPromise = getPool();
  return _poolPromise;
}

/* -----------------------------
   Table bootstrap + mappers
------------------------------*/
async function ensureTable() {
  const pool = await ensurePool();
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

/* -----------------------------
   Handler
------------------------------*/
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    const q = req.query || {};

    // ---------- Built-in diagnostics ----------
    if (q.ping) {
      return res.status(200).json({ ok: true, hasDbUrl: Boolean(DATABASE_URL) });
    }

    if (q.diag === "2") {
      const info = {
        ok: true,
        rawInputLength: String(RAW_URL_INPUT || "").length,
        cleanedPresent: Boolean(DATABASE_URL),
        cleaned: DATABASE_URL || null,
        parsedOk: !!parsedUrl,
      };

      if (parsedUrl) {
        info.scheme = parsedUrl.protocol;
        info.host = parsedUrl.hostname;
        info.port = parsedUrl.port || "(default)";
        info.pathname = parsedUrl.pathname;
        info.hasSslmode = /\bsslmode=/.test(parsedUrl.search);
        try {
          const dns = (await import("node:dns")).promises;
          // show both A and AAAA attempts
          try { info.lookup4 = await dns.lookup(parsedUrl.hostname, { family: 4 }); } catch (e) { info.lookup4err = String(e?.message || e); }
          try { info.lookup6 = await dns.lookup(parsedUrl.hostname, { family: 6 }); } catch (e) { info.lookup6err = String(e?.message || e); }
        } catch (e) {
          info.dnsError = String(e?.message || e);
        }
      } else if (DATABASE_URL) {
        info.parseError = "Invalid URL format";
      } else {
        info.missing = "No DATABASE_URL/database_url set";
      }

      return res.status(200).json(info);
    }

    if (q.diag) {
      const pool = await ensurePool();
      if (!pool) return res.status(500).json({ ok: false, error: "DATABASE_URL not set" });
      try {
        const r = await pool.query("select now() as now");
        return res.status(200).json({ ok: true, now: r.rows[0].now });
      } catch (e) {
        console.error("diag error:", e);
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
      }
    }

    if (q.count) {
      const pool = await ensurePool();
      if (!pool) return res.status(500).json({ ok: false, error: "DATABASE_URL not set" });
      try {
        await ensureTable();
        const r = await pool.query("select count(*)::int as c from listings");
        return res.status(200).json({ ok: true, count: r.rows[0].c });
      } catch (e) {
        console.error("count error:", e);
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
      }
    }
    // ------------------------------------------

    const pool = await ensurePool();
    if (!pool) {
      return res.status(500).json({ ok: false, error: "DATABASE_URL not set" });
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
      if (!body.id)   return res.status(400).json({ ok: false, error: "Missing id" });
      if (!body.group) return res.status(400).json({ ok: false, error: "Missing group" });

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
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
