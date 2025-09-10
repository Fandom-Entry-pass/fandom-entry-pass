import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;

    // mark issue + cancel (releases auth back to buyer)
    await stripe.paymentIntents.update(piId, { metadata: { fep_status: "issue_reported" } });
    const canceled = await stripe.paymentIntents.cancel(piId);

    return res.status(200).json({ canceled: true, payment_intent: canceled.id });
  } catch (err) {
    console.error("report-issue error:", err);
    return res.status(500).json({ error: "Failed to cancel intent" });
  }
}
