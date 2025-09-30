// api/report-issue.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(String(sessionId))) {
      return res.status(400).json({ error: "Invalid sessionId" });
    }

    // Retrieve Checkout Session and PaymentIntent
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi =
      typeof session?.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session?.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // Idempotency/short-circuits
    if (pi.status === "succeeded") {
      return res.status(400).json({ error: "Payment already captured; cannot cancel authorization" });
    }
    if (pi.status === "canceled") {
      return res.status(200).json({
        canceled: true,
        payment_intent: pi.id,
        alreadyCanceled: true
      });
    }

    // Only cancel if we're still authorized (requires_capture)
    if (pi.status !== "requires_capture") {
      return res.status(400).json({
        error: "PaymentIntent not in a cancelable state",
        status: pi.status
      });
    }

    // Mark metadata then cancel the auth
    const now = Math.floor(Date.now() / 1000);
    const meta = {
      ...(pi.metadata || {}),
      fep_status: "issue_reported",
      fep_canceled_at: String(now)
    };
    await stripe.paymentIntents.update(pi.id, { metadata: meta });

    const canceled = await stripe.paymentIntents.cancel(
      pi.id,
      { cancellation_reason: "requested_by_customer" },
      { idempotencyKey: `cancel:${pi.id}` }
    );

    return res.status(200).json({ canceled: true, payment_intent: canceled.id });
  } catch (err) {
    console.error("report-issue error:", err);
    return res.status(500).json({ error: "Failed to cancel intent" });
  }
}
