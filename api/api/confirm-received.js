import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (!session || !session.payment_intent) {
      return res.status(404).json({ error: "Session or PaymentIntent not found" });
    }

    const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
    const captured = await stripe.paymentIntents.capture(piId);

    return res.status(200).json({ captured: true, payment_intent: captured.id });
  } catch (err) {
    console.error("confirm-received error:", err);
    return res.status(500).json({ error: "Failed to capture payment" });
  }
}
