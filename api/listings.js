// api/listings.js
export const config = { runtime: "nodejs" };

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
  // Supabase needs SSL. Add if missing.
  if (!/\bsslmode=/.test(out)) out += (out.includes("?") ? "&" : "?") + "sslmode=require";
  return out;
}
const RAW_URL_INPUT = process.env.DATABASE_URL ?? process.env.database_url ?? "";
const DATABASE_URL  = cleanDbUrl(RAW_URL_INPUT);

let parsedUrl = null;
try { if (DATABASE_URL) parsedUrl = new URL(DATABASE_URL); } catch {}

/* -----------------------------
   Dual-stack resolver + Pool
------------------------------*/
let _poolPromise = null;

async function resolve6(hostname) {
  try { const dns = (await import("node:dns")).promises; const a = await dns.resolve6(hostname); return a?.[0] || null; }
  catch { return null; }
}
async function resolve4(hostname) {
  try { const dns = (await import("node:dns")).promises; const a = await dns.resolve4(hostname); return a?.[0] || null; }
  catch { return null; }
}
async function pickAddress(hostname) {
  const v6 = await resolve6(hostname);
  if (v6) return { host: v6, family: 6 };
  const v4 = await resolve4(hostname);
  if (v4) return { host: v4, family: 4 };
  return { host: hostname, family: 0 }; // fall back to hostname
}

async function getPool() {
  if (!DATABASE_URL || !parsedUrl) return null;

  const user     = decodeURIComponent(parsedUrl.username || "");
  const password = decodeURIComponent(parsedUrl.password || "");
  const database = (parsedUrl.pathname || "").replace(/^\//, "") || "postgres";
  const port     = parsedUrl.port ? Number(parsedUrl.port) : 5432;
  const hostname = parsedUrl.hostname;

  const { host: hostOrIp, family } = await pickAddress(hostname);

  return new Pool({
    host: hostOrIp,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000,
    application_name: `fep-api (ipFamily=${family})`,
  });
}

async function ensurePool() {
  if (!_poolPromise) _poolPromise = getPool();
  return _poolPromise;
}

/* -----------------------------
   Bootstrap + mapping helpers
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
    remaining: r.remaining == null ? (r.qty == null ? null : Number(r.qty)) : Number(r.remaining),
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

    // ---- Diagnostics (keep for easy debugging) ----
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
        versionTag: "dualstack-pg",
      };
      if (parsedUrl) {
        info.scheme = parsedUrl.protocol;
        info.host = parsedUrl.hostname;
        info.port = parsedUrl.port || "(default)";
        info.pathname = parsedUrl.pathname;
        info.hasSslmode = /\bsslmode=/.test(parsedUrl.search);
        try {
          const dns = (await import("node:dns")).promises;
          try { info.resolve6 = await dns.resolve6(parsedUrl.hostname); } catch (e) { info.resolve6err = String(e?.message || e); }
          try { info.resolve4 = await dns.resolve4(parsedUrl.hostname); } catch (e) { info.resolve4err = String(e?.message || e); }
        } catch (e) { info.dnsError = String(e?.message || e); }
      } else if (DATABASE_URL) {
        info.parseError = "Invalid URL format";
      } else {
        info.missing = "No DATABASE_URL/database_url set";
      }
      return res.status(200).json(info);
    }

    // Raw TCP check (tries v6 then v4)
    if (q.tcp) {
      if (!parsedUrl) return res.status(400).json({ ok:false, error:"No DATABASE_URL" });
      const net = await import("node:net");
      const host = parsedUrl.hostname;
      const port = parsedUrl.port ? Number(parsedUrl.port) : 5432;

      async function tryConnect(target) {
        return new Promise((resolve) => {
          const s = net.createConnection({ host: target, port, timeout: 4000 }, () => {
            s.destroy();
            resolve({ ok:true, reached: target, port });
          });
          s.on("error", (e) => resolve({ ok:false, error:String(e?.code||e), reached: target, port }));
          s.on("timeout", () => { s.destroy(); resolve({ ok:false, error:"TIMEOUT", reached: target, port }); });
        });
      }

      const v6 = await resolve6(host);
      const v4 = await resolve4(host);
      const r6 = v6 ? await tryConnect(v6) : { ok:false, error:"NO_AAAA" };
      const r4 = v4 ? await tryConnect(v4) : { ok:false, error:"NO_A" };
      return res.status(200).json({ ok:true, host, port, v6, v4, tcp6: r6, tcp4: r4 });
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
    // --------------------------------

    const pool = await ensurePool();
    if (!pool) return res.status(500).json({ ok: false, error: "DATABASE_URL not set" });

    await ensureTable();

    if (req.method === "GET") {
      const { rows } = await pool.query("SELECT * FROM listings ORDER BY updated_at DESC LIMIT 500");
      return res.status(200).json({ ok: true, items: rows.map(mapRow) });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (!b.id)    return res.status(400).json({ ok:false, error:"Missing id" });
      if (!b.group) return res.status(400).json({ ok:false, error:"Missing group" });

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
          date_text  = EXCLUDED.date_text,
          city       = EXCLUDED.city,
          seat       = EXCLUDED.seat,
          face       = EXCLUDED.face,
          price      = EXCLUDED.price,
          qty        = EXCLUDED.qty,
          remaining  = EXCLUDED.remaining,
          pay        = EXCLUDED.pay,
          seller     = EXCLUDED.seller,
          seller_email       = EXCLUDED.seller_email,
          seller_phone       = EXCLUDED.seller_phone,
          seller_account_id  = EXCLUDED.seller_account_id,
          edit_token = EXCLUDED.edit_token,
          manage_code= EXCLUDED.manage_code,
          updated_at = now()
        RETURNING *;
      `;
      const vals = [
        String(b.id),
        String(b.group || ""),
        b.date == null ? null : String(b.date),
        b.city == null ? null : String(b.city),
        b.seat == null ? null : String(b.seat),
        b.face == null ? null : Number(b.face),
        b.price == null ? null : Number(b.price),
        b.qty == null ? null : Number(b.qty),
        b.remaining == null ? null : Number(b.remaining),
        b.pay == null ? null : String(b.pay || ""),
        b.seller == null ? null : String(b.seller || ""),
        b.sellerEmail == null ? null : String(b.sellerEmail || ""),
        b.sellerPhone == null ? null : String(b.sellerPhone || ""),
        b.sellerAccountId == null ? null : String(b.sellerAccountId || ""),
        b.editToken == null ? null : String(b.editToken || ""),
        b.manageCode == null ? null : String(b.manageCode || ""),
        b.createdAt ? new Date(b.createdAt) : null,
      ];
      const { rows } = await pool.query(sql, vals);
      return res.status(200).json({ ok:true, item: mapRow(rows[0]) });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  } catch (err) {
    console.error("api/listings error:", err);
    return res.status(500).json({ ok:false, error: err?.message || "Server error" });
  }
}
