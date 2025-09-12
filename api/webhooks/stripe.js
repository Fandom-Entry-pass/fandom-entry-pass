// api/webhooks/stripe.js
import Stripe from "stripe";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;

// Read raw request body without 'micro'
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  let event;
  try {
    const buf = await readRawBody(req);
    const sig = req.headers["stripe-signature"];

    // If WHSEC not set, allow plain JSON (dev fallback)
    if (!WHSEC) {
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
      const piId = session.payment_intent;
      const deadline = Math.floor(Date.now() / 1000) + 72 * 3600; // 72h

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

      console.log("✅ escrow deadline set:", deadline, "PI:", piId);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Webhook handler error" });
  }
}
