// /api/listings.js
export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    return res.status(500).json({ error: "Missing Supabase env vars" });
  }

  const base = `${SUPABASE_URL}/rest/v1/listings`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };

  try {
    // Fetch latest listings (frontend uses this to sync across devices)
    if (req.method === "GET") {
      const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
      const url = `${base}?select=*&order=created_at.desc&limit=${limit}`;
      const r = await fetch(url, { method: "GET", headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data });
      return res.status(200).json(data);
    }

    // Create a new listing – accept the full listing object from the frontend
    if (req.method === "POST") {
      const body = req.body;
      if (!body) {
        return res.status(400).json({ error: "Missing request body" });
      }
      const rows = Array.isArray(body) ? body : [body];
      const r = await fetch(base, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(rows),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data });
      const row = Array.isArray(data) ? data[0] : data;
      return res.status(201).json(row);
    }

    // Update an existing listing by id
    if (req.method === "PATCH") {
      const { id, ...updates } = req.body || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(`${base}?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify(updates),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data });
      return res.status(200).json(Array.isArray(data) ? data[0] : data);
    }

    // Delete a listing by id
    if (req.method === "DELETE") {
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: "Missing id" });
      const r = await fetch(`${base}?id=eq.${id}`, {
        method: "DELETE",
        headers,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: data });
      }
      return res.status(204).end();
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
