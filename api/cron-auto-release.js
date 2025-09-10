// Schedule this in Vercel: e.g., "0 * * * *" (hourly)
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  // Optional: restrict to GET or to a CRON header
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const now = Math.floor(Date.now() / 1000);
  const results = { checked: 0, captured: 0, canceled: 0, errors: 0 };

  try {
    // Search all PaymentIntents in auth state we marked (requires_capture + metadata fep=1)
    const search = await stripe.paymentIntents.search({
      // See https://stripe.com/docs/search
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
