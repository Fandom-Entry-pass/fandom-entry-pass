// /api/listings.js  (Serverless)
// One endpoint for both GET (read all) and POST (upsert one listing)
// Uses Upstash Redis REST (free) via env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

export const config = { runtime: "edge" };

const KEY = "fep:listings:v1";

async function kvGet(reqEnv) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = reqEnv;
  const r = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(KEY)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    cache: "no-store"
  });
  const d = await r.json();
  let arr = [];
  try { arr = d.result ? JSON.parse(d.result) : []; } catch {}
  if (!Array.isArray(arr)) arr = [];
  return arr;
}

async function kvSet(reqEnv, value) {
  const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } = reqEnv;
  const body = new URLSearchParams();
  body.set("value", JSON.stringify(value));
  // NX/XX not used—just overwrite atomically
  const r = await fetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!r.ok) throw new Error(`KV set failed: ${r.status}`);
}

function json(data, init = 200) {
  return new Response(JSON.stringify(data), {
    status: typeof init === "number" ? init : init.status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

export default async function handler(req) {
  try {
    const env = process.env;
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      return json({ ok: false, error: "KV not configured" }, 500);
    }

    if (req.method === "GET") {
      const items = await kvGet(env);
      return json({ ok: true, items });
    }

    if (req.method === "POST") {
      const listing = await req.json().catch(() => null);
      if (!listing || typeof listing !== "object") return json({ ok:false, error:"Invalid JSON" }, 400);
      if (!listing.id) return json({ ok:false, error:"Missing listing.id" }, 400);

      // Load, upsert, save
      const items = await kvGet(env);
      const i = items.findIndex(x => String(x.id) === String(listing.id));
      const nowIso = new Date().toISOString();
      const toSave = { ...listing };
      if (!toSave.createdAt) toSave.createdAt = nowIso;
      toSave.updatedAt = nowIso;

      if (i >= 0) items[i] = toSave; else items.unshift(toSave);
      await kvSet(env, items);
      return json({ ok: true, item: toSave, count: items.length });
    }

    return json({ ok:false, error:"Method not allowed" }, 405);
  } catch (e) {
    return json({ ok:false, error: e?.message || "Server error" }, 500);
  }
}


