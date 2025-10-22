// /api/capture-order.js
// Node.js Serverless friendly (CommonJS). CORS + timeout guards + client step for session-status refresh.

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

exports.config = { runtime: "nodejs" };

// Helper timeout wrapper
function withTimeout(promise, ms = 7000, errMsg = "Upstream timeout") {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(errMsg)), ms))),
  ]);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sid, pi, amount_to_capture } = req.body || {};

    // ---- Resolve PaymentIntent ----
    let paymentIntentId = pi;
    if (!paymentIntentId) {
      if (!sid || typeof sid !== "string") {
        return res.status(400).json({ error: "Missing sid or pi" });
      }
      const session = await withTimeout(
        stripe.checkout.sessions.retrieve(String(sid)),
        7000,
        "Stripe session retrieve timeout"
      );
      paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;
      if (!paymentIntentId)
        return res.status(400).json({ error: "No payment_intent found on Checkout Session" });
    }

    // ---- Verify PI eligible ----
    const intent = await withTimeout(
      stripe.paymentIntents.retrieve(paymentIntentId),
      7000,
      "Stripe PI retrieve timeout"
    );

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

    // ---- Capture ----
    const params = {};
    if (typeof amount_to_capture === "number" && Number.isFinite(amount_to_capture)) {
      if (amount_to_capture <= 0)
        return res.status(400).json({ error: "amount_to_capture must be > 0 (in cents)" });
      if (amount_to_capture > intent.amount_capturable) {
        return res.status(400).json({
          error: "amount_to_capture exceeds amount_capturable",
          amount_to_capture,
          amount_capturable: intent.amount_capturable,
        });
      }
      params.amount_to_capture = Math.floor(amount_to_capture);
    }

    const captured = await withTimeout(
      stripe.paymentIntents.capture(paymentIntentId, params),
      7000,
      "Stripe capture timeout"
    );

    const charges = (captured.charges && captured.charges.data) || [];
    const latestCharge = charges.length ? charges[charges.length - 1] : null;

    // ---- Client follow-up: trigger /api/session-status ----
    // This makes a quick internal fetch so inventory updates automatically.
    let sessionStatus = null;
    if (sid) {
      try {
        const origin =
          process.env.APP_BASE_URL ||
          (req.headers.origin ? String(req.headers.origin) : "");
        const statusUrl = `${origin}/api/session-status?sid=${encodeURIComponent(sid)}`;
        const resp = await fetch(statusUrl);
        sessionStatus = await resp.json();
      } catch (e) {
        console.warn("Session-status update failed:", e.message);
      }
    }

    // ---- Respond to client ----
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
      session_status: sessionStatus, // includes listing_update_applied flag if success
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
