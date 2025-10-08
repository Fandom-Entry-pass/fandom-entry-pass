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

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    const pi =
      typeof session?.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session?.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // ✅ New: ensure this is an escrow flow (manual capture)
    if (pi.capture_method !== "manual") {
      return res.status(400).json({ error: "Payment not in escrow (manual capture required)" });
    }

    // Idempotency / short-circuits
    if (pi.status === "succeeded") {
      return res.status(400).json({ error: "Payment already captured; cannot cancel authorization" });
    }
    if (pi.status === "canceled") {
      return res.status(200).json({ canceled: true, payment_intent: pi.id, alreadyCanceled: true });
    }

    // Only cancel while authorized
    if (pi.status !== "requires_capture") {
      return res.status(400).json({ error: "PaymentIntent not in a cancelable state", status: pi.status });
    }

    const now = Math.floor(

