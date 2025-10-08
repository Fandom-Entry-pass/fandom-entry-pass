// api/cancel-order.js
import Stripe from "stripe";
export const config = { runtime: "nodejs" };
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { sessionId } = await req.json?.() || req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const cs = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi = cs.payment_intent;
    if (!pi) return res.status(404).json({ error: "PaymentIntent not found" });

    const meta = pi.metadata || {};
    if (pi.status !== "requires_capture") return res.status(400).json({ error: "Not cancelable" });
    if (meta.fep_status === "sent")   return res.status(409).json({ error: "Already sent" });
    if (meta.fep_status === "on_hold") return res.status(409).json({ error: "On hold" });

    await stripe.paymentIntents.cancel(
      pi.id,
      { cancellation_reason: "requested_by_customer" },
      { idempotencyKey: `buyer-cancel:${pi.id}` }
    );
    await stripe.paymentIntents.update(pi.id, {
      metadata: { ...meta, fep_status: "canceled", fep_canceled_at: String(Math.floor(Date.now()/1000)) }
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("cancel-order error:", e);
    return res.status(500).json({ error: "Failed to cancel" });
  }
}
