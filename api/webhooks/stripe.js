import Stripe from "stripe";
import { buffer } from "micro";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const buf = await buffer(req);
    if (!WHSEC) {
      // Dev fallback only
      event = JSON.parse(buf.toString());
    } else {
      event = stripe.webhooks.constructEvent(buf, sig, WHSEC);
    }
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // mark PaymentIntent with our escrow metadata
      const piId = session.payment_intent;
      const deadline = Math.floor(Date.now() / 1000) + 72 * 3600; // now + 72h (epoch seconds)
      await stripe.paymentIntents.update(piId, {
        metadata: {
          fep: "1",
          fep_status: "authorized",
          fep_confirm_deadline: String(deadline),
          listingId: session.metadata?.listingId || "",
          buyerEmail: session.metadata?.buyerEmail || "",
          sellerEmail: session.metadata?.sellerEmail || "",
        },
      });
      console.log("✅ escrow set, deadline:", deadline, "PI:", piId);
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
}
