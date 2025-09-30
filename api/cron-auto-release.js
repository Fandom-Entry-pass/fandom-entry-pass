// api/cron-auto-release.js
// Scheduled task: capture or cancel authorized PaymentIntents after the 72h deadline.
// Trigger this from GitHub Actions (or any scheduler) with a secret:
//   GET /api/cron-auto-release?key=YOUR_SECRET
// or set header: Authorization: Bearer YOUR_SECRET

import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Shared secret for external scheduler auth
const CRON_SECRET = process.env.CRON_SECRET || null;

// Safety cap on operations per run (capture+cancel combined)
const DEFAULT_MAX_OPS = Number(process.env.CRON_MAX_OPS || 150);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Auth: allow either query ?key= or Authorization: Bearer
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const qsKey = String(req.query?.key || "");
  const provided = bearer || qsKey;
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(403).json({ error: "Forbidden – missing/invalid cron secret" });
  }

  // Optional: per-run cap override (?maxOps=50)
  const maxOps = Math.max(1, Math.min(Number(req.query?.maxOps || DEFAULT_MAX_OPS), 1000));

  const now = Math.floor(Date.now() / 1000);
  const results = {
    checked: 0,
    due: 0,
    captured: 0,
    canceled: 0,
    skipped_on_hold: 0,
    already_final: 0,
    errors: 0,
    maxOps
  };

  try {
    // Search all PaymentIntents that belong to FEP and are authorized/awaiting capture
    // https://stripe.com/docs/search#search-query-language
    const query = "status:'requires_capture' AND metadata['fep']:'1'";

    // Iterate pages; stop if we hit the per-run operation cap
    for await (const pi of stripe.paymentIntents.search({ query, limit: 100 })) {
      if (results.captured + results.canceled >= maxOps) break;

      results.checked++;

      if (pi.status !== "requires_capture") {
        results.already_final++;
        continue;
      }

      const meta = pi.metadata || {};
      const deadline = Number(meta.fep_confirm_deadline || 0);
      const fepStatus = String(meta.fep_status || "");
      const isOnHold =
        fepStatus === "on_hold" || fepStatus === "issue_reported" || fepStatus === "dispute";

      // No deadline? skip (defensive)
      if (!deadline) continue;

      // Not yet due
      if (now < deadline) continue;

      results.due++;

      try {
        if (isOnHold) {
          // If issue was reported (or you marked on-hold), cancel after deadline.
          await stripe.paymentIntents.cancel(
            pi.id,
            { cancellation_reason: "requested_by_customer" },
            { idempotencyKey: `cron-cancel:${pi.id}` }
          );
          await stripe.paymentIntents.update(pi.id, {
            metadata: { ...meta, fep_status: "canceled" }
          });
          results.canceled++;
        } else {
          // Otherwise auto-capture after deadline
          await stripe.paymentIntents.capture(pi.id, {}, { idempotencyKey: `cron-capture:${pi.id}` });
          await stripe.paymentIntents.update(pi.id, {
            metadata: { ...meta, fep_status: "captured" }
          });
          results.captured++;
        }
      } catch (e) {
        // If state changed between search & action (e.g., manually paused), count as skipped
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
