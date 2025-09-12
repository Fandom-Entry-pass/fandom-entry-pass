// api/report-issue.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    // Get the session + PI
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const intent = session?.payment_intent;

    if (!intent) return res.status(404).json({ error: "PaymentIntent not found" });

    // If already captured, you may want a different path (refund flow or 400)
    if (intent.status === "succeeded" || intent.status === "requires_refund") {
      return res.status(400).json({ error: "Payment already captured; cannot cancel authorization" });
    }

    // Merge metadata so we don't wipe other keys
    const meta = { ...(intent.metadata || {}), fep_status: "issue_reported" };
    await stripe.paymentIntents.update(intent.id, { metadata: meta });

    // Cancel the authorization (releases hold to buyer)
    const canceled = await stripe.paymentIntents.cancel(intent.id);

    return res.status(200).json({ canceled: true, payment_intent: canceled.id });
  } catch (err) {
    console.error("report-issue error:", err);
    return res.status(500).json({ error: "Failed to cancel intent" });
  }
}
