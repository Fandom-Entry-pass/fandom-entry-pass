// api/cron-auto-release.js
// Runs via Vercel Cron (*/15 * * * *). Captures or cancels PaymentIntents after the 72h deadline.

import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Optional: set CRON_SECRET to let you run this manually like
// /api/cron-auto-release?key=YOUR_SECRET
const CRON_SECRET = process.env.CRON_SECRET || null;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Allow only Vercel Cron or a manual run with a shared secret
  const isCron = req.headers["x-vercel-cron"] === "1";
  const hasKey = CRON_SECRET && req.query?.key === CRON_SECRET;
  if (!isCron && !hasKey) {
    return res.status(403).json({ error: "Forbidden – cron only" });
  }

  const now = Math.floor(Date.now() / 1000);
  const results = {
    checked: 0,
    due: 0,
    captured: 0,
    canceled: 0,
    skipped_on_hold: 0,
    already_final: 0,
    errors: 0
  };

  try {
    // Find all FEP PaymentIntents that are still awaiting capture
    const query = "status:'requires_capture' AND metadata['fep']:'1'";

    // Auto-pagination: iterates over all pages, not just the first 100
    for await (const pi of stripe.paymentIntents.search({ query, limit: 100 })) {
      results.checked++;

      // Defensive: only operate on requires_capture
      if (pi.status !== "requires_capture") {
        results.already_final++;
        continue;
      }

      const meta = pi.metadata || {};
      const deadline = Number(meta.fep_confirm_deadline || 0);
      const fepStatus = String(meta.fep_status || "");
      const isOnHold = fepStatus === "on_hold" || fepStatus === "issue_reported" || fepStatus === "dispute";

      // Not configured with a deadline? Skip safely.
      if (!deadline) continue;

      // Not yet due.
      if (now < deadline) continue;

      results.due++;

      try {
        if (isOnHold) {
          // If an issue was reported (or manually put on hold), cancel after deadline.
          await stripe.paymentIntents.cancel(
            pi.id,
            { cancellation_reason: "requested_by_customer" },
            { idempotencyKey: `cron-cancel:${pi.id}` }
          );
          await stripe.paymentIntents.update(pi.id, { metadata: { ...meta, fep_status: "canceled" } });
          results.canceled++;
        } else {
          // Otherwise, auto-capture after deadline.
          await stripe.paymentIntents.capture(pi.id, {}, { idempotencyKey: `cron-capture:${pi.id}` });
          await stripe.paymentIntents.update(pi.id, { metadata: { ...meta, fep_status: "captured" } });
          results.captured++;
        }
      } catch (e) {
        // If a human paused it after we read, count as skipped
        if (e?.code === "payment_intent_unexpected_state") {
          results.skipped_on_hold++;
        } else {
          console.error("auto-release action failed for", pi.id, e);
          results.errors++;
        }
      }
    }
  } catch (e) {
    console.error("cron search error:", e);
    return res.status(500).json({ ok: false, now, ...results, error: e.message });
  }

  return res.status(200).json({ ok: true, now, ...results });
}
