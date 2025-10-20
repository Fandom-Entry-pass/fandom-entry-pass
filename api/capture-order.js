// /api/capture-order.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

/**
 * Body (JSON):
 * {
 *   sid?: string,                 // Checkout Session ID, e.g. "cs_test_..."
 *   pi?: string,                  // PaymentIntent ID, e.g. "pi_test_..."
 *   amount_to_capture?: number    // (optional) amount in cents <= amount_capturable
 * }
 *
 * Returns:
 * 200 { ok: true, payment_intent, charge_id, amount_captured }
 * 4xx { error: string, ...context }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sid, pi, amount_to_capture } = req.body || {};

    // 1) Resolve PaymentIntent ID
    let paymentIntentId = pi;
    if (!paymentIntentId) {
      if (!sid) return res.status(400).json({ error: "Missing sid or pi" });

      const session = await stripe.checkout.sessions.retrieve(String(sid), {
        expand: ["payment_intent"],
      });

      paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

      if (!paymentIntentId) {
        return res
          .status(400)
          .json({ error: "No payment_intent found on Checkout Session" });
      }
    }

    // 2) Fetch current intent state
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Must be manual auth-only to capture later
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

    // 3) Prepare capture params (optional partial capture)
    const params = {};
    if (
      typeof amount_to_capture === "number" &&
      Number.isFinite(amount_to_capture)
    ) {
      if (amount_to_capture <= 0) {
        return res
          .status(400)
          .json({ error: "amount_to_capture must be > 0 (in cents)" });
      }
      if (amount_to_capture > intent.amount_capturable) {
        return res.status(400).json({
          error:
            "amount_to_capture exceeds amount_capturable for this PaymentIntent.",
          amount_to_capture,
          amount_capturable: intent.amount_capturable,
        });
      }
      params.amount_to_capture = Math.floor(amount_to_capture);
    }

    // 4) Capture
    const captured = await stripe.paymentIntents.capture(paymentIntentId, params);

    // Best-effort: pick the most recent charge id & amount captured
    const latestCharge =
      Array.isArray(captured.charges?.data) && captured.charges.data.length
        ? captured.charges.data[captured.charges.data.length - 1]
        : null;

    return res.status(200).json({
      ok: true,
      payment_intent: {
        id: captured.id,
        status: captured.status,
        amount: captured.amount,
        amount_captured: captured.amount_captured,
        currency: captured.currency,
      },
      charge_id: latestCharge?.id || null,
      amount_captured: captured.amount_captured,
    });
  } catch (err) {
    console.error("capture-order error:", err);
    // Propagate Stripe’s helpful message when available
    return res.status(400).json({
      error: err?.message || "Capture failed",
      type: err?.type || null,
      code: err?.code || null,
    });
  }
}

