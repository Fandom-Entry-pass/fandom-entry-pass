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

    const meta = pi.metadata || session.metadata || {};

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

    // Amounts
    const amount_total = pi.amount ?? session.amount_total ?? null; // in cents
    const currency = (pi.currency || session.currency || "usd").toLowerCase();

    // Helpful echo of metadata (if present)
    const listingId = meta.listingId || session.metadata?.listingId || null;
    const sellerAccountId = meta.sellerAccountId || session.metadata?.sellerAccountId || null;

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      payment_intent: pi.id,
      status,
      requires_capture,
      succeeded,
      canceled,
      deadline,                 // unix seconds
      now: Math.floor(Date.now() / 1000),
      amount_total,             // cents
      currency,
      fep_status: meta.fep_status || "",
      listingId,
      sellerAccountId,
    });
  } catch (e) {
    console.error("session-status error:", e);
    if (e?.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(500).json({ error: "Failed to get status" });
  }
}

