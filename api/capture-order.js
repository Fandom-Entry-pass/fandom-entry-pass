// /api/capture-order.js
// Node.js Serverless friendly (CommonJS). Safe CORS + fast-fail + timeout guard.

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Ensure Node runtime on Vercel (harmless if ignored by your framework)
exports.config = { runtime: "nodejs" };

/** Small helper to guarantee we don't exceed serverless time limits */
function withTimeout(promise, ms = 7000, errMsg = "Upstream timeout") {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(errMsg)), ms))),
  ]);
}

module.exports = async function handler(req, res) {
  // CORS headers (adjust origin if you want to restrict)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle CORS preflight quickly to avoid timeouts
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sid, pi, amount_to_capture } = req.body || {};

    // 1) Resolve PaymentIntent id (from pi or sid)
    let paymentIntentId = pi;
    if (!paymentIntentId) {
      if (!sid || typeof sid !== "string") {
        return res.status(400).json({ error: "Missing sid or pi" });
      }

      // Do not expand to keep the call lightweight
      const session = await withTimeout(
        stripe.checkout.sessions.retrieve(String(sid)),
        7000,
        "Stripe session retrieve timeout"
      );

      paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : null;

      if (!paymentIntentId) {
        return res.status(400).json({ error: "No payment_intent found on Checkout Session" });
      }
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
