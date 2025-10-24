// api/listings.js
import { Pool } from "pg";

export const config = { runtime: "nodejs" };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL env var");
}

// Supabase (and many hosted Postgres) require SSL in serverless
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

// Ensure table exists (runs once per cold start)
const ensure = pool.query(`
  create table if not exists fep_listings (
    id text primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
  );
  create index if not exists fep_listings_updated_at_idx on fep_listings(updated_at desc);
`);

function cleanListing(input) {
  // Minimal validation + normalization (mirror your frontend fields)
  const n = v => (v == null || v === "" ? null : Number(v));
  const s = v => (v == null ? "" : String(v).trim());

  return {
    id: s(input.id) || crypto.randomUUID(),
    group: s(input.group),
    date: s(input.date),
    city: s(input.city),
    seat: s(input.seat),
    face: n(input.face) ?? 0,
    price: n(input.price) ?? 0,
    qty: Math.max(1, n(input.qty) ?? 1),
    remaining: Math.max(0, n(input.remaining) ?? n(input.qty) ?? 1),
    pay: s(input.pay),
    seller: s(input.seller) || "Seller",
    sellerEmail: s(input.sellerEmail).toLowerCase(),
    sellerPhone: s(input.sellerPhone),
    sellerAccountId: s(input.sellerAccountId),
    editToken: s(input.editToken),
    manageCode: s(input.manageCode),
    createdAt: s(input.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  // prevent any caching
  res.setHeader("Cache-Control", "no-store");

  try {
    await ensure; // make sure table/index exist

    if (req.method === "GET") {
      const { rows } = await pool.query(
        "select data from fep_listings order by updated_at desc limit 500"
      );
      const items = rows.map(r => r.data);
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === "POST") {
      const listing = cleanListing(req.body || {});
      if (!listing.group || !listing.date) {
        return res.status(400).json({ ok: false, error: "Missing required fields (group, date)" });
      }
      // Upsert by id
      await pool.query(
        `
        insert into fep_listings (id, data, updated_at)
        values ($1, $2, now())
        on conflict (id)
        do update set data = excluded.data, updated_at = now()
        `,
        [listing.id, listing]
      );
      return res.status(200).json({ ok: true, id: listing.id });
    }

    if (req.method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
      await pool.query("delete from fep_listings where id = $1", [String(id)]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,DELETE");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e) {
    console.error("api/listings error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

