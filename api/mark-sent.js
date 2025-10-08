// api/mark-sent.js
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
    const cs = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (!cs) return res.status(404).json({ error: "Session not found" });

    const pi =
      typeof cs.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(cs.payment_intent)
        : cs.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // Only meaningful while authorized (escrow)
    if (pi.status !== "requires_capture") {
      return res.status(400).json({ error: "Not in escrow/awaiting capture", status: pi.status });
    }

    const meta = pi.metadata || {};
    const fepStatus = String(meta.fep_status || "");

    // If an issue was reported or a hold/dispute is active, don't allow "sent"
    if (["issue_reported", "on_hold", "dispute"].includes(fepStatus)) {
      return res.status(409).json({ error: "On hold/disputed; cannot mark sent" });
    }
    // Already marked sent? (idempotent)
    if (fepStatus === "sent") {
      return res.status(200).json({ ok: true, payment_intent: pi.id, alreadySent: true });
    }

    await stripe.paymentIntents.update(pi.id, {
      metadata: {
        ...meta,
        fep_status: "sent",
        fep_sent_at: String(Math.floor(Date.now() / 1000))
      }
    });

    return res.status(200).json({ ok: true, payment_intent: pi.id });
  } catch (e) {
    console.error("mark-sent error:", e);
    return res.status(500).json({ error: "Failed to mark sent" });
  }
}

