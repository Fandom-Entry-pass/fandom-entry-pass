// api/webhooks/stripe.js
import Stripe from "stripe";

/**
 * Ensure Node runtime + raw body (required for Stripe signature verification)
 */
export const config = { api: { bodyParser: false }, runtime: "nodejs" };

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

async function setEscrowDeadlineIfNeeded(piId, opts = {}) {
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (!pi?.id) return;

    // Only set for manual-capture intents that are actually authorized
    const manual = pi.capture_method === "manual";
    const isAuthorized = pi.status === "requires_capture";
    const alreadyHasDeadline = Number(pi.metadata?.fep_confirm_deadline || 0) > 0;

    if (!manual || !isAuthorized || alreadyHasDeadline) return;

    const DEFAULT_ESCROW_SECS = 72 * 3600;
    const deadline = Math.floor(Date.now() / 1000) + DEFAULT_ESCROW_SECS;

    // Preserve existing metadata and mirror pass-through details if present
    const meta = {
      ...(pi.metadata || {}),
      fep: "1",
      fep_status: "authorized",
      fep_confirm_deadline: String(deadline),
      listingId: pi.metadata?.listingId ?? opts.listingId ?? "",
      buyerEmail: pi.metadata?.buyerEmail ?? opts.buyerEmail ?? "",
      sellerEmail: pi.metadata?.sellerEmail ?? opts.sellerEmail ?? "",
      sellerAccountId: pi.metadata?.sellerAccountId ?? opts.sellerAccountId ?? "",
      buyer_fee_cents: pi.metadata?.buyer_fee_cents ?? opts.buyer_fee_cents ?? "",
      seller_fee_cents: pi.metadata?.seller_fee_cents ?? opts.seller_fee_cents ?? ""
    };

    await stripe.paymentIntents.update(piId, { metadata: meta });
    console.log("✅ [webhook] escrow deadline set", { piId, deadline });
  } catch (e) {
    console.warn("⚠️ [webhook] setEscrowDeadlineIfNeeded failed:", e?.message || e);
  }
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
      /**
       * Fires when Checkout succeeds. With manual capture, the PI will be requires_capture (authorized).
       * We set the 72h confirm deadline if not already set.
       */
      case "checkout.session.completed": {
        const session = event.data.object;

        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!piId) {
          console.error("[stripe-webhook] No payment_intent on session", session.id);
          break;
        }

        await setEscrowDeadlineIfNeeded(piId, {
          listingId: session.metadata?.listingId,
          buyerEmail: session.metadata?.buyerEmail,
          sellerEmail: session.metadata?.sellerEmail,
          sellerAccountId: session.metadata?.sellerAccountId,
          buyer_fee_cents: session.metadata?.buyer_fee_cents,
          seller_fee_cents: session.metadata?.seller_fee_cents
        });

        break;
      }

      /**
       * Sometimes amount_capturable is updated after certain flows.
       * Treat this as "authorized" and ensure deadline is present.
       */
      case "payment_intent.amount_capturable_updated": {
        const pi = event.data.object;
        if (!pi?.id) break;

        await setEscrowDeadlineIfNeeded(pi.id);

        // Ensure status marker (don’t clobber other metadata)
        const meta = { ...(pi.metadata || {}), fep_status: "authorized" };
        await stripe.paymentIntents.update(pi.id, { metadata: meta }).catch(() => {});
        break;
      }

      /**
       * When you (or buyer confirmation) captures the PI.
       */
      case "payment_intent.succeeded": {
        const pi = event.data.object;
        if (!pi?.id) break;

        const now = Math.floor(Date.now() / 1000);
        const meta = { ...(pi.metadata || {}), fep_status: "captured", fep_captured_at: String(now) };
        await stripe.paymentIntents.update(pi.id, { metadata: meta }).catch(() => {});
        console.log("✅ [webhook] captured", { piId: pi.id });
        break;
      }

      /**
       * If an auth gets canceled (buyer reported issue or expired and you canceled),
       * mark metadata so your UI can reflect it.
       */
      case "payment_intent.canceled": {
        const pi = event.data.object;
        if (!pi?.id) break;

        const now = Math.floor(Date.now() / 1000);
        const meta = { ...(pi.metadata || {}), fep_status: "canceled", fep_canceled_at: String(now) };
        await stripe.paymentIntents.update(pi.id, { metadata: meta }).catch(() => {});
        console.log("✅ [webhook] canceled", { piId: pi.id });
        break;
      }

      // Optional future handling:
      // case "charge.dispute.created": { /* set fep_status:on_hold or similar */ break; }

      default: {
        // No-op for other event types
        break;
      }
    }

    // Always acknowledge; prevents Stripe retries
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error:", err);
    // Prefer 200 to avoid retry storms; you can switch to 500 if you want Stripe to retry.
    return res.status(200).json({ received: true, note: "handled with warnings" });
  }
}
