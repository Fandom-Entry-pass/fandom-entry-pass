// api/webhooks/stripe.js
import Stripe from "stripe";

/**
 * Ensure Node runtime + raw body (required for Stripe signature verification)
 */
export const config = { api: { bodyParser: false }, runtime: "nodejs18.x" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Read raw request body (no external deps)
 */
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  let event;
  try {
    const buf = await readRawBody(req);
    const sig = req.headers["stripe-signature"];

    if (!WHSEC) {
      // In production we should *always* have a webhook secret.
      // Fallback to explicit error to avoid accepting spoofed webhooks.
      console.error("[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET");
      return res.status(500).send("Server misconfigured: missing STRIPE_WEBHOOK_SECRET");
    }

    event = stripe.webhooks.constructEvent(buf, sig, WHSEC);
  } catch (err) {
    console.error("[stripe-webhook] verify failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Session can contain a string id or an expanded object for payment_intent
        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!piId) {
          console.error("[stripe-webhook] No payment_intent on session", session.id);
          break;
        }

        // 72h escrow window (in UNIX seconds)
        const deadline = Math.floor(Date.now() / 1000) + 72 * 3600;

        await stripe.paymentIntents.update(piId, {
          metadata: {
            // markers your other routes rely on
            fep: "1",
            fep_status: "authorized",
            fep_confirm_deadline: String(deadline),
            // pass-through metadata (defensive defaults)
            listingId: session.metadata?.listingId ?? "",
            buyerEmail: session.metadata?.buyerEmail ?? "",
            sellerEmail: session.metadata?.sellerEmail ?? ""
          }
        });

        console.log("✅ [stripe-webhook] escrow deadline set", {
          piId,
          deadline
        });
        break;
      }

      // (Optional) If you later need to pause auto-capture on disputes:
      // case "charge.dispute.created": { /* mark on_hold in your DB/metadata */ break; }

      default: {
        // No-op for other event types
        break;
      }
    }

    // Always 200 once processed (prevents Stripe retries)
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // 200 with received=true is generally preferred to avoid endless retries
    // when your own downstream system fails. If you want Stripe to retry,
    // change this to a 500.
    return res.status(200).json({ received: true, note: "handled with warnings" });
  }
}
