// ...unchanged imports & setup...

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

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent", "payment_intent.charges.data.balance_transaction"]
    });

    const pi =
      typeof session?.payment_intent === "string"
        ? await stripe.paymentIntents.retrieve(session.payment_intent)
        : session?.payment_intent;

    if (!pi?.id) return res.status(404).json({ error: "PaymentIntent not found" });

    // ✅ NEW: must be manual capture for escrow flow
    if (pi.capture_method !== "manual") {
      return res.status(400).json({ error: "Payment not in escrow (manual capture required)" });
    }

    // If already captured, short-circuit
    if (pi.status === "succeeded") {
      return res.status(200).json({ captured: true, payment_intent: pi.id, alreadyCaptured: true });
    }

    // ✅ (lifecycle hint) If you want, you can reflect the current intent status:
    // const preStatus = pi.status === "requires_capture" ? "authorized" : pi.status;

    // Deadline check (72h window)
    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(pi.metadata?.fep_confirm_deadline || 0);
    if (deadline && now > deadline) {
      return res.status(400).json({ error: "Confirmation window expired" });
    }

    // ---- Capture funds ----
    const captured = await stripe.paymentIntents.capture(
      pi.id,
      {},
      { idempotencyKey: `capture:${pi.id}` }
    );

    // ---- Compute payout ----
    const md = { ...(pi.metadata || {}) };
    const price = Number(md.price || 0);
    const qty = Math.max(1, Number(md.qty || 1));
    const sellerAccountId = String(md.sellerAccountId || "");

    const platformFeePerTicket = price * 0.05 + 0.75;
    const payoutPerTicket = Math.max(0, price - platformFeePerTicket);
    const totalPayout = Math.max(0, payoutPerTicket * qty);

    const chargeId = captured?.charges?.data?.[0]?.id || pi.latest_charge || null;

    if (sellerAccountId && totalPayout > 0 && chargeId) {
      await stripe.transfers.create({
        amount: Math.round(totalPayout * 100),
        currency: "usd",
        destination: sellerAccountId,
        source_transaction: chargeId,
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

    await stripe.paymentIntents.update(pi.id, {
      metadata: {
        ...md,
        fep_status: "captured",
        fep_captured_at: String(now),
