import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const { sid } = req.query || {};
  if (!sid) return res.status(400).json({ error: "Missing sid" });

  try {
    const session = await stripe.checkout.sessions.retrieve(String(sid), { expand: ["payment_intent"] });
    const pi = typeof session.payment_intent === "string" ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;

    const meta = pi?.metadata || {};
    const deadline = Number(meta.fep_confirm_deadline || 0);
    const status = pi?.status || "unknown";
    const capturable = pi?.charges?.data?.length ? false : true; // info; not critical
    const requiresCapture = pi?.status === "requires_capture";

    return res.status(200).json({
      ok: true,
      sessionId: session.id,
      payment_intent: pi?.id || null,
      requiresCapture,
      status,
      deadline, // epoch seconds
      now: Math.floor(Date.now() / 1000),
      fep_status: meta.fep_status || "",
    });
  } catch (e) {
    console.error("session-status error:", e);
    return res.status(500).json({ error: "Failed to get status" });
  }
}
