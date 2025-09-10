// api/cron-auto-release.js
// Vercel Cron Job: checks PaymentIntents every hour (or 15 min if scheduled that way)

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extra safety: only run if called by Vercel Cron
  // Comment this out if you want to test manually in the browser
  if (req.headers["x-vercel-cron"] !== "1") {
    return res.status(403).json({ error: "Forbidden – cron only" });
  }

  const now = Math.floor(Date.now() / 1000);
  const results = { checked: 0, captured: 0, canceled: 0, errors: 0 };

  try {
    // Search for PaymentIntents still waiting for capture
    const search = await stripe.paymentIntents.search({
      query: `status:'requires_capture' AND metadata['fep']:'1'`,
      limit: 100,
    });

    for (const pi of search.data) {
      results.checked++;
      const meta = pi.metadata || {};
      const deadline = Number(meta.fep_confirm_deadline || 0);
      const flagged = meta.fep_status === "issue_reported";

      if (deadline && now >= deadline) {
        try {
          if (flagged) {
            await stripe.paymentIntents.cancel(pi.id);
            results.canceled++;
          } else {
            await stripe.paymentIntents.capture(pi.id);
            results.captured++;
          }
        } catch (e) {
          console.error("auto-release action failed for", pi.id, e);
          results.errors++;
        }
      }
    }
  } catch (e) {
    console.error("cron search error:", e);
    return res.status(500).json({ ok: false, error: e.message, ...results });
  }

  return res.status(200).json({ ok: true, now, ...results });
}
