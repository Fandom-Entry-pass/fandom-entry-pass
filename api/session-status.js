// api/session-status.js
import Stripe from "stripe";
import fs from "fs/promises";
import path from "path";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ---- Simple file helpers (replace with your DB if needed) ----
const DATA_DIR = path.join(process.cwd(), "data");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const LEDGER_FILE = path.join(DATA_DIR, "processed-intents.json");

async function readJsonSafe(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonSafe(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2));
}
// ---------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sid = (req.query?.sid || req.query?.sessionId || "").toString().trim();
  if (!sid) return res.status(400).json({ error: "Missing sid" });
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) {
    return res.status(400).json({ error: "Invalid sid" });
  }

  try {
    // Retrieve Checkout Session + PI (keep expand minimal for perf)
    const session = await stripe.checkout.sessions.retrieve(sid, {
      expand: ["payment_intent", "payment_intent.latest_charge.balance_transaction"],
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const pi =
      typeof session.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    const smeta = session.metadata || {};
    const pmeta = pi.metadata || {};
    const meta = { ...smeta, ...pmeta };

    // Status flags
    const status = pi.status || session.status || "unknown";
    const requires_capture = status === "requires_capture";
    const succeeded = status === "succeeded";
    const canceled = status === "canceled";

    // Deadline: prefer metadata; else default to +72h from PI creation
    const createdSec = pi.created || session.created || Math.floor(Date.now() / 1000);
    const DEFAULT_ESCROW_SECS = 72 * 3600;
    let deadline = Number(meta.fep_confirm_deadline || 0);
    if (!Number.isFinite(deadline) || deadline <= createdSec) {
      deadline = createdSec + DEFAULT_ESCROW_SECS;
    }

    const now = Math.floor(Date.now() / 1000);
    const time_remaining = Math.max(0, deadline - now);

    // Currency and totals (cents)
    const currency = (pi.currency || session.currency || "usd").toLowerCase();

    // Pull fee & pricing hints from metadata (set in create-checkout-session)
    const qty = Number(meta.qty || 1);
    const priceUsd = Number(meta.price || 0); // per ticket (USD)
    const buyer_fee_cents = Number(meta.buyer_fee_cents || 0);
    const seller_fee_cents = Number(meta.seller_fee_cents || 0);

    // Derive helpful numbers safely
    const unit_cents = Math.round(priceUsd * 100) || 0;
    const ticket_subtotal_cents = unit_cents * (Number.isFinite(qty) && qty > 0 ? qty : 1);
    const buyer_total_cents =
      (Number.isFinite(ticket_subtotal_cents) ? ticket_subtotal_cents : 0) +
      (Number.isFinite(buyer_fee_cents) ? buyer_fee_cents : 0);
    const seller_estimated_payout_cents =
      (Number.isFinite(ticket_subtotal_cents) ? ticket_subtotal_cents : 0) -
      (Number.isFinite(seller_fee_cents) ? seller_fee_cents : 0);

    // Include amount_total if Stripe computed it
    const amount_total = Number.isFinite(session.amount_total) ? session.amount_total : null;

    // Helpful echoes
    const listingId = meta.listingId || null;
    const sellerAccountId = meta.sellerAccountId || null;
    const fep_status = meta.fep_status || "";

    // Convenience flags for UI (non-breaking additions)
    const on_hold = ["on_hold", "issue_reported", "dispute"].includes(fep_status);
    const can_buyer_cancel = requires_capture && fep_status === "authorized" && !succeeded && !canceled;
    const can_buyer_confirm = requires_capture && !on_hold && !succeeded && !canceled;
    const can_report_issue = requires_capture && !succeeded && !canceled;

    // ---------- NEW: Idempotent quantity + seats update on success ----------
    // Only apply when final payment is succeeded AND we have identifiers.
    let listing_update_applied = false;
    let last_sale_seats = [];

    if (succeeded && listingId && Number.isFinite(qty) && qty > 0) {
      try {
        // simple ledger so we don't double-deduct on polling
        const ledger = await readJsonSafe(LEDGER_FILE, { processed: [] });
        if (!ledger.processed.includes(pi.id)) {
          const listings = await readJsonSafe(LISTINGS_FILE, []);
          const idx = listings.findIndex((l) => String(l.id) === String(listingId));
          if (idx !== -1) {
            const L = listings[idx];

            // decrement remaining
            const beforeRemaining = Number.isFinite(L.remaining) ? Number(L.remaining) : Number(L.total || 0) || 0;
            const purchased = Math.min(qty, Math.max(0, beforeRemaining));
            const afterRemaining = Math.max(0, beforeRemaining - purchased);
            L.remaining = afterRemaining;

            // mark seats as sold if seatNumbers exist
            if (Array.isArray(L.seatNumbers) && L.seatNumbers.length) {
              const sold = Array.isArray(L.soldSeats) ? L.soldSeats : [];
              const available = L.seatNumbers.filter((s) => !sold.includes(s));
              last_sale_seats = available.slice(0, purchased);
              L.soldSeats = [...sold, ...last_sale_seats];
            }

            listings[idx] = L;
            await writeJsonSafe(LISTINGS_FILE, listings);

            // record processed PI
            ledger.processed.push(pi.id);
            await writeJsonSafe(LEDGER_FILE, ledger);

            listing_update_applied = true;
          }
        }
      } catch (err) {
        console.error("listing quantity update error:", err);
        // do not fail the whole request; just report in response
      }
    }
    // -----------------------------------------------------------------------

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      payment_intent: pi.id,

      status,
      requires_capture,
      succeeded,
      canceled,

      deadline,                 // unix seconds
      now,                      // unix seconds
      time_remaining,           // seconds until deadline (0 when expired)

      // Stripe computed (if present)
      amount_total,             // cents
      currency,

      // FEP metadata/status
      fep_status,
      listingId,
      sellerAccountId,

      // Derived pricing snapshot
      qty: Number.isFinite(qty) ? qty : 1,
      unit_cents,
      ticket_subtotal_cents,
      buyer_fee_cents,
      buyer_total_cents,
      seller_fee_cents,
      seller_estimated_payout_cents,

      // Helpful UI flags
      on_hold,
      can_buyer_cancel,
      can_buyer_confirm,
      can_report_issue,

      // NEW response hints for your UI
      listing_update_applied,
      last_sale_seats,
    });
  } catch (e) {
    console.error("session-status error:", e);
    if (e?.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(500).json({ error: "Failed to get status" });
  }
}

