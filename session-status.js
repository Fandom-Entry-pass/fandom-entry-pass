// api/session-status.js
import Stripe from "stripe";

export const config = { runtime: "nodejs18.x" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { sid } = req.query || {};
  const sessionId = String(sid || "");

  if (!sessionId) return res.status(400).json({ error: "Missing sid" });
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: "Invalid sid" });
  }

  try {
    // Retrieve the Checkout Session and associated PaymentIntent
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const pi =
      typeof session.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    const meta = pi.metadata || {};
    const deadline = Number(meta.fep_confirm_deadline || 0);
    const now = Math.floor(Date.now() / 1000);

    // Stripe escrow state
    const status = pi.status || "unknown";
    const requiresCapture = status === "requires_capture";

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      payment_intent: pi.id,
      requiresCapture,
      status,
      deadline, // epoch seconds
      now,
      fep_status: meta.fep_status || ""
    });
  } catch (e) {
    console.error("session-status error:", e);
    // If Stripe says not found, return 404 to help frontend logic
    if (e?.statusCode === 404) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.status(500).json({ error: "Failed to get status" });
  }
}
