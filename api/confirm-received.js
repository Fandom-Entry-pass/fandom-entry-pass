// api/confirm-received.js
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
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.charges.data.balance_transaction"]
    });

    const pi =
      typeof session?.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session?.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // If already captured, we can still ensure transfer (idempotent-ish), but
    // for simplicity return early. If you want to also ensure transfer ran,
    // you could inspect previous metadata/transfer records here.
    if (pi.status === "succeeded") {
      return res.status(200).json({ captured: true, payment_intent: pi.id, alreadyCaptured: true });
    }

    // Enforce confirmation deadline (72h or whatever you set when creating the session)
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(pi.metadata?.fep_confirm_deadline || 0);
    if (deadline && now > deadline) {
      return res.status(400).json({ error: "Confirmation window expired" });
    }

    // ---- Capture escrowed funds (idempotently) ----
    const captured = await stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: `capture:${pi.id}` }
    );

    // ---- Compute seller payout and transfer to connected account ----
    // We expect these to have been set in /api/create-checkout-session
    // (add them there if you haven't yet)
    const md = { ...(pi.metadata || {}) };

    const price = Number(md.price || 0);                  // per ticket, USD
    const qty = Math.max(1, Number(md.qty || 1));        // quantity
    const sellerAccountId = String(md.sellerAccountId || "");

    // Seller platform fee = 5% + $0.75 per ticket
    const platformFeePerTicket = price * 0.05 + 0.75;
    const payoutPerTicket = Math.max(0, price - platformFeePerTicket);
    const totalPayout = Math.max(0, payoutPerTicket * qty);

    // Find the charge that was captured (useful to anchor the transfer)
    const chargeId = captured?.charges?.data?.[0]?.id || pi.latest_charge || null;

    // Only transfer if we have a connected account and a positive payout
    if (sellerAccountId && totalPayout > 0 && chargeId) {
      await stripe.transfers.create({
        amount: Math.round(totalPayout * 100),  // cents
        currency: "usd",
        destination: sellerAccountId,
        source_transaction: chargeId,           // ties transfer to this charge
        metadata: {
          listingId: md.listingId || "",
          reason: "FEP payout after buyer confirmation",
          qty: String(qty),
          price: String(price),
          platformFeePerTicket: platformFeePerTicket.toFixed(2),
          totalPayout: totalPayout.toFixed(2)
        }
      });
    }

    // Update metadata to reflect final state
    await stripe.paymentIntents.update(pi.id, {
      metadata: {
        ...md,
        fep_status: "captured",
        fep_captured_at: String(now),
        fep_payout_usd: totalPayout ? totalPayout.toFixed(2) : "0"
      }
    });

    return res.status(200).json({
      captured: true,
      payment_intent: captured.id,
      payout_sent: Boolean(sellerAccountId && totalPayout > 0 && chargeId)
    });
  } catch (err) {
    console.error("confirm-received error:", err);
    return res.status(500).json({ error: "Failed to capture payment" });
  }
}
