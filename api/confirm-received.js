// /api/confirm-received.js
import Stripe from "stripe";
export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Flat buyer fee per order, keep in sync with create-checkout-session
const BUYER_FEE_CENTS = 350;
const CONFIRM_HOURS = Number(process.env.FEP_CONFIRM_HOURS || 72);

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

    // Keep expands minimal for performance; no need to expand balance tx here
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    // Resolve PaymentIntent
    const pi =
      typeof session?.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session?.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // Must be manual capture for escrow
    if (pi.capture_method !== "manual") {
      return res.status(409).json({ error: "Payment not in escrow (manual capture required)" });
    }

    // Already captured? Make this idempotent
    if (pi.status === "succeeded") {
      return res.status(200).json({
        ok: true,
        alreadyCaptured: true,
        payment_intent: { id: pi.id, status: pi.status, amount_captured: pi.amount_captured },
      });
    }

    // Not ready to capture yet?
    if (pi.status !== "requires_capture") {
      return res.status(409).json({
        error: `Cannot capture: intent status is '${pi.status}'`,
        status: pi.status,
        amount_capturable: pi.amount_capturable,
      });
    }

    // Optional: confirm within window
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(pi.metadata?.fep_confirm_deadline || 0);
    if (deadline && now > deadline) {
      return res.status(400).json({ error: "Confirmation window expired" });
    }

    // ---- Capture funds (idempotent) ----
    const captured = await stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: `capture:${pi.id}` }
    );

    // ---- Compute payout (platform fee 5% + $0.75 per ticket) ----
    const md = { ...(pi.metadata || {}) };
    const price = Number(md.price || 0);     // per-ticket USD
    const qty = Math.max(1, Number(md.qty || 1));
    const sellerAccountId = String(md.sellerAccountId || "");

    const platformFeePerTicket = price * 0.05 + 0.75;
    const payoutPerTicket = Math.max(0, price - platformFeePerTicket);
    const totalPayoutUSD = Math.max(0, payoutPerTicket * qty);
    const totalPayoutCents = Math.round(totalPayoutUSD * 100);

    // Last charge id to use as source_transaction (charge must be captured)
    const chargeId =
      captured?.charges?.data?.[0]?.id ||
      pi.latest_charge ||
      null;

    // Try transfer, but don't fail the whole request if it errors
    let transferResult = null;
    let transferWarning = null;

    if (sellerAccountId && totalPayoutCents > 0 && chargeId) {
      try {
        transferResult = await stripe.transfers.create({
          amount: totalPayoutCents,
          currency: "usd",
          destination: sellerAccountId,
          source_transaction: chargeId,
          metadata: {
            listingId: md.listingId || "",
            reason: "FEP payout after buyer confirmation",
            qty: String(qty),
            price: String(price),
            platformFeePerTicket: platformFeePerTicket.toFixed(2),
            totalPayout: totalPayoutUSD.toFixed(2),
          },
        });
      } catch (e) {
        // Common reasons: destination not enabled for transfers, or not connected
        transferWarning = e?.message || "Transfer failed";
        // We still continue – funds are captured to the platform; you can reconcile later.
      }
    }

    // Update PI metadata to reflect capture (non-blocking if it fails)
    try {
      await stripe.paymentIntents.update(pi.id, {
        metadata: {
          ...md,
          fep_status: "captured",
          fep_captured_at: String(now),
        },
      });
    } catch (_) {
      // ignore
    }

    return res.status(200).json({
      ok: true,
      payment_intent: {
        id: captured.id,
        status: captured.status,
        amount_captured: captured.amount_captured,
        currency: captured.currency,
      },
      charge_id: chargeId,
      payout: {
        destination: sellerAccountId || null,
        total_payout_cents: totalPayoutCents,
        transfer_id: transferResult?.id || null,
        warning: transferWarning || null,
      },
    });
  } catch (err) {
    console.error("confirm-received error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
