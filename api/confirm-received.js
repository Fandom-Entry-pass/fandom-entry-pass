import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

    // Retrieve checkout session + intent
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const intent = session?.payment_intent;
    if (!intent || typeof intent === "string") {
      return res.status(404).json({ error: "PaymentIntent not found" });
    }

    // Check deadline metadata
    const deadline = Number(intent.metadata?.fep_confirm_deadline || 0);
    const now = Math.floor(Date.now() / 1000);
    if (deadline && now > deadline) {
      return res.status(400).json({ error: "Confirmation window expired" });
    }

    // Capture funds
    const captured = await stripe.paymentIntents.capture(intent.id);

    // Update metadata to reflect captured
    await stripe.paymentIntents.update(intent.id, {
      metadata: {
        ...intent.metadata,
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
