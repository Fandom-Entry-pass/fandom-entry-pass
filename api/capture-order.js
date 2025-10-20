// /api/capture-order.js  (CommonJS; safe on Vercel Node serverless)
const Stripe = require("stripe");

// ── Stripe client with short timeout & minimal retries
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  timeout: 10000,          // 10s cap so we don't hit Vercel hard timeout
  maxNetworkRetries: 0,    // don't keep retrying forever
});

// ── Tiny helper to send JSON consistently
function send(res, code, obj) {
  res.status(code).json(obj);
}

module.exports = async function handler(req, res) {
  // ── Allow OPTIONS quickly (avoids preflight hangs if any)
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  try {
    // Some environments can deliver undefined/empty bodies: guard that.
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const { sid, pi, amount_to_capture } = body;

    // ── Fast-fail if identifiers missing
    if (!sid && !pi) return send(res, 400, { error: "Missing sid or pi" });

    // ── Resolve the PaymentIntent id
    let paymentIntentId = pi;
    if (!paymentIntentId && sid) {
      // Do NOT expand large objects—keep it lean to avoid long responses
      const session = await stripe.checkout.sessions.retrieve(String(sid));
      paymentIntentId = (typeof session.payment_intent === "string") ? session.payment_intent : null;
      if (!paymentIntentId) return send(res, 400, { error: "No payment_intent found on session" });
    }

    // ── Fetch PI and validate state
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.capture_method !== "manual") {
      return send(res, 409, {
        error: "Cannot capture: capture_method is not 'manual'.",
        capture_method: intent.capture_method,
        status: intent.status,
      });
    }
    if (intent.status !== "requires_capture") {
      return send(res, 409, {
        error: `Cannot capture: intent status is '${intent.status}'.`,
        status: intent.status,
        amount_capturable: intent.amount_capturable,
      });
    }

    // ── Optional partial capture
    const params = {};
    if (typeof amount_to_capture === "number" && Number.isFinite(amount_to_capture)) {
      if (amount_to_capture <= 0) return send(res, 400, { error: "amount_to_capture must be > 0 (cents)" });
      if (amount_to_capture > intent.amount_capturable) {
        return send(res, 400, {
          error: "amount_to_capture exceeds amount_capturable",
          amount_to_capture,
          amount_capturable: intent.amount_capturable,
        });
      }
      params.amount_to_capture = Math.floor(amount_to_capture);
    }

    // ── Capture
    const captured = await stripe.paymentIntents.capture(paymentIntentId, params);

    const charges = (captured.charges && captured.charges.data) || [];
    const latestCharge = charges.length ? charges[charges.length - 1] : null;

    return send(res, 200, {
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
    return send(res, 400, {
      error: err?.message || "Capture failed",
      type: err?.type || null,
      code: err?.code || null,
    });
  }
};

// IMPORTANT: Ensure this route is NOT on Edge runtime. It must be Node.js.
// If you have runtime configs elsewhere, do NOT set `export const config = { runtime: 'edge' }` for this file.


}

