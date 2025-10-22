// /api/capture-order.js
// Node.js Serverless friendly (CommonJS). CORS, timeouts, and post-capture inventory decrement.

const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Ensure Node runtime on Vercel (harmless if ignored by your framework)
exports.config = { runtime: "nodejs" };

/** --- Config for optional file-based listings DB --- */
const DB_PATH = process.env.TICKETS_DB_PATH || path.join(process.cwd(), "data", "tickets.json");

/** Small helper to guarantee we don't exceed serverless time limits */
function withTimeout(promise, ms = 7000, errMsg = "Upstream timeout") {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(errMsg)), ms))),
  ]);
}

/** ---- Inventory helpers (file-based; safe no-op if file missing) ---- */
function readListingsSafe() {
  try {
    if (!fs.existsSync(DB_PATH)) return { ok: false, reason: "db_missing" };
    const text = fs.readFileSync(DB_PATH, "utf8");
    const db = JSON.parse(text);
    if (!Array.isArray(db)) return { ok: false, reason: "db_not_array" };
    return { ok: true, db };
  } catch (e) {
    return { ok: false, reason: "db_read_failed", error: e.message };
  }
}

function writeListingsSafe(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "db_write_failed", error: e.message };
  }
}

/**
 * Decrement inventory and optionally assign seats.
 * Accepts either:
 *  - listingId: string/number
 *  - qty: integer
 * Behavior:
 *  - Decrements l.remaining (or l.quantity if remaining not present)
 *  - Increments l.sold
 *  - If l.seatNumbers is an array, assigns first `qty` seats and appends to l.assignedSeats
 */
function decrementInventoryFile(listingId, qty) {
  const result = { usedDB: false, updated: false, assignedSeats: [], remaining: null };

  const read = readListingsSafe();
  if (!read.ok) {
    result.reason = read.reason;
    result.error = read.error || null;
    return result; // safe no-op
  }

  const db = read.db;
  const idx = db.findIndex((l) => String(l.id) === String(listingId));
  if (idx === -1) {
    result.reason = "listing_not_found";
    return result;
  }

  const l = db[idx];

  const currentRemaining = Number.isFinite(l.remaining)
    ? l.remaining
    : Number.isFinite(l.quantity)
    ? l.quantity
    : 0;

  if (qty > currentRemaining) {
    // still decrement to zero, or choose to fail; here we clamp to avoid negative
    l.remaining = 0;
  } else {
    l.remaining = currentRemaining - qty;
  }

  l.sold = (l.sold || 0) + qty;

  // Assign seats if available
  const assigned = [];
  if (Array.isArray(l.seatNumbers) && l.seatNumbers.length) {
    while (assigned.length < qty && l.seatNumbers.length) {
      assigned.push(l.seatNumbers.shift());
    }
    l.assignedSeats = (l.assignedSeats || []).concat(assigned);
  }

  db[idx] = l;
  const write = writeListingsSafe(db);

  result.usedDB = true;
  result.updated = !!write.ok;
  result.remaining = l.remaining;
  result.assignedSeats = assigned;
  if (!write.ok) {
    result.reason = write.reason;
    result.error = write.error || null;
  }
  return result;
}

module.exports = async function handler(req, res) {
  // CORS headers (adjust origin if you want to restrict)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  // Handle CORS preflight quickly to avoid timeouts
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sid, pi, amount_to_capture } = req.body || {};

    // 1) Resolve PaymentIntent id (from pi or sid) and capture source for metadata
    let paymentIntentId = pi;
    let session = null;
    let sourceForMetadata = "intent"; // "intent" or "session"

    if (!paymentIntentId) {
      if (!sid || typeof sid !== "string") {
        return res.status(400).json({ error: "Missing sid or pi" });
      }

      // Retrieve the Checkout Session (no heavy expand)
      session = await withTimeout(
        stripe.checkout.sessions.retrieve(String(sid)),
        7000,
        "Stripe session retrieve timeout"
      );

      paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "No payment_intent found on Checkout Session" });
      }
      sourceForMetadata = "session";
    }

    // 2) Get intent state (fast)
    const intent = await withTimeout(
      stripe.paymentIntents.retrieve(paymentIntentId),
      7000,
      "Stripe PI retrieve timeout"
    );

    // Must be manual + requires_capture for escrow capture
    if (intent.capture_method !== "manual") {
      return res.status(409).json({
        error: "Cannot capture: capture_method is not 'manual'.",
        capture_method: intent.capture_method,
        status: intent.status,
      });
    }

    if (intent.status !== "requires_capture") {
      return res.status(409).json({
        error: `Cannot capture: intent status is '${intent.status}'.`,
        status: intent.status,
        amount_capturable: intent.amount_capturable,
      });
    }

    // 3) Optional partial capture validation
    const params = {};
    if (typeof amount_to_capture === "number" && Number.isFinite(amount_to_capture)) {
      if (amount_to_capture <= 0) {
        return res.status(400).json({ error: "amount_to_capture must be > 0 (in cents)" });
      }
      if (amount_to_capture > intent.amount_capturable) {
        return res.status(400).json({
          error: "amount_to_capture exceeds amount_capturable",
          amount_to_capture,
          amount_capturable: intent.amount_capturable,
        });
      }
      params.amount_to_capture = Math.floor(amount_to_capture);
    }

    // 4) Capture (bounded by timeout)
    const captured = await withTimeout(
      stripe.paymentIntents.capture(paymentIntentId, params),
      7000,
      "Stripe capture timeout"
    );

    // 5) Extract listingId + qty to update inventory
    //    Prefer intent.metadata (set via payment_intent_data.metadata),
    //    fall back to session.metadata (set at session level),
    //    and finally to line items quantity if needed.
    //    If we didn't retrieve session earlier (no sid), we can fetch it via the PI's latest_checkout_session.
    let listingId =
      (intent.metadata && (intent.metadata.listingId || intent.metadata.listing_id)) || null;
    let qtyPurchased =
      (intent.metadata && Number(intent.metadata.qty)) ||
      Number.isFinite(Number(intent.metadata?.quantity)) ? Number(intent.metadata?.quantity) : NaN;

    // If session was passed in or we already had it, check its metadata too
    if ((!listingId || !Number.isFinite(qtyPurchased)) && (sid || session)) {
      if (!session && captured.latest_charge) {
        // Best-effort: try to get the Checkout Session id tied to this PI
        // Not always present; skip if unavailable.
        // (We avoid heavy expands for speed/timeouts.)
      }
      const s = session
        ? session
        : sid
        ? await withTimeout(
            stripe.checkout.sessions.retrieve(String(sid)),
            7000,
            "Stripe session retrieve timeout (post-capture)"
          )
        : null;

      if (s) {
        if (!listingId) {
          listingId =
            (s.metadata && (s.metadata.listingId || s.metadata.listing_id)) || listingId;
        }
        if (!Number.isFinite(qtyPurchased)) {
          const q =
            (s.metadata && Number(s.metadata.qty)) ||
            (s.metadata && Number(s.metadata.quantity));
          if (Number.isFinite(q)) qtyPurchased = q;
        }
      }
    }

    // As a last resort, sum line items to get qty (extra call; only if needed)
    if (!Number.isFinite(qtyPurchased)) {
      const sidMaybe =
        session?.id ||
        (intent.latest_charge && intent.latest_charge.checkout_session) ||
        (sid || null);
      if (sidMaybe) {
        try {
          const items = await withTimeout(
            stripe.checkout.sessions.listLineItems(String(sidMaybe), { limit: 100 }),
            7000,
            "Stripe line items timeout"
          );
          qtyPurchased = items.data.reduce((n, li) => n + (li.quantity || 0), 0);
        } catch (_) {
          // ignore; leave qtyPurchased as NaN
        }
      }
    }

    // Sanitize listingId/qty
    if (!listingId) listingId = intent.metadata?.listing_id || null;
    if (!Number.isFinite(qtyPurchased) || qtyPurchased <= 0) qtyPurchased = 1;

    // 6) Update inventory (file-based; safe no-op if no DB)
    const invResult = decrementInventoryFile(listingId, qtyPurchased);

    const charges = (captured.charges && captured.charges.data) || [];
    const latestCharge = charges.length ? charges[charges.length - 1] : null;

    return res.status(200).json({
      ok: true,
      payment_intent: {
        id: captured.id,
        status: captured.status,
        amount: captured.amount,
        amount_captured: captured.amount_captured,
        currency: captured.currency,
      },
      charge_id: latestCharge ? latestCharge.id : null,
      amount_captured: captured.amount_captured,

      // Echo useful context back to your UI / logs
      listingId,
      qtyPurchased,
      inventory_update: invResult, // {usedDB, updated, remaining, assignedSeats, reason?}
      metadata_source: sourceForMetadata,
    });
  } catch (err) {
    console.error("capture-order error:", err);
    return res.status(400).json({
      error: err?.message || "Capture failed",
      type: err?.type || null,
      code: err?.code || null,
    });
  }
};
