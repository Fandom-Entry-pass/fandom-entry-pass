// /api/capture-order.js  (CommonJS, Node runtime)
"use strict";

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // Handle both parsed and raw bodies defensively
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const sid = body.sid || null;
    const pi = body.pi || null;
    const amount_to_capture = body.amount_to_capture;

    // 1) Resolve PaymentIntent id
    let paymentIntentId = pi;
    if (!paymentIntentId) {
      if (!sid) return res.status(400).json({ error: "Missing sid or pi" });
      const session = await stripe.checkout.sessions.retrieve(String(sid), { expand: ["payment_intent"] });
      paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent && session.payment_intent.id) || null;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "No payment_intent found on Checkout Session" });
      }
    }

    // 2) Fetch current intent state
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.capture_method !== "manual") {
      return res.status(409).json({
        error: "Cannot capture: capture_method is not 'manual'.",
        capture_method: intent.capture_method,
        status: intent.status,
      });
    }
    if (intent.status !== "requires_capture") {
      return res.status(409).json({
        error: "Cannot capture: intent status is not 'requires_capture'.",
        status: intent.status,
        amount_capturable: intent.amount_capturable,
      });
    }

    // 3) Optional partial capture
    const params = {};
    if (Number.isFinite(Number(amount_to_capture))) {
      const amt = Math.floor(Number(amount_to_capture));
      if (amt <= 0 || amt > intent.amount_capturable) {
        return res.status(400).json({
          error: "Invalid amount_to_capture",
          amount_to_capture: amt,
          amount_capturable: intent.amount_capturable,
        });
      }
      params.amount_to_capture = amt;
    }

    // 4) Capture
    const captured = await stripe.paymentIntents.capture(paymentIntentId, params);
    const charges = (captured && captured.charges && captured.charges.data) || [];
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
    });
  } catch (err) {
    console.error("capture-order error:", err);
    return res.status(400).json({
      error: (err && err.message) || "Capture failed",
      type: err && err.type ? err.type : null,
      code: err && err.code ? err.code : null,
    });
  }
};

}

