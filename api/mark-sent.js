// api/mark-sent.js
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

    // Find the PaymentIntent
    const cs = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi = cs.payment_intent;
    if (!pi || pi.status !== "requires_capture") {
      return res.status(400).json({ error: "Not in escrow/awaiting capture" });
    }

    const meta = pi.metadata || {};
    // If an issue already reported, don’t flip to sent
    if (meta.fep_status === "on_hold") return res.status(409).json({ error: "On hold (disputed)" });

    await stripe.paymentIntents.update(pi.id, {
      metadata: {
        ...meta,
        fep_status: "sent",
        fep_sent_at: String(Math.floor(Date.now()/1000))
      }
    });

    return res.status(200).json({ ok: true, payment_intent: pi.id });
  } catch (e) {
    console.error("mark-sent error:", e);
    return res.status(500).json({ error: "Failed to mark sent" });
  }
}
