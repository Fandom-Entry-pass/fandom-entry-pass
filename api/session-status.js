// api/session-status.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

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
    // Retrieve Checkout Session + PI
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

      // Helpful UI flags (optional; purely additive)
      on_hold,
      can_buyer_cancel,
      can_buyer_confirm,
      can_report_issue,
    });
  } catch (e) {
    console.error("session-status error:", e);
    if (e?.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(500).json({ error: "Failed to get status" });
  }
}

