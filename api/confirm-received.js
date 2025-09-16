// api/confirm-received.js
import Stripe from "stripe";

export const config = { runtime: "nodejs18.x" };

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

    // If already captured, return early (idempotent UX)
    if (pi.status === "succeeded") {
      return res.status(200).json({ captured: true, payment_intent: pi.id, alreadyCaptured: true });
    }

    // Enforce 72h deadline
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(pi.metadata?.fep_confirm_deadline || 0);
    if (deadline && now > deadline) {
      return res.status(400).json({ error: "Confirmation window expired" });
    }

    // Capture funds with idempotency to avoid double-captures on retries
    const captured = await stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: `capture:${pi.id}` }
    );

    // Update metadata to reflect final state
    await stripe.paymentIntents.update(pi.id, {
      metadata: {
        ...(pi.metadata || {}),
        fep_status: "captured",
        fep_captured_at: String(now)
      }
    });

    return res.status(200).json({ captured: true, payment_intent: captured.id });
  } catch (err) {
    console.error("confirm-received error:", err);
    return res.status(500).json({ error: "Failed to capture payment" });
  }
}

}
