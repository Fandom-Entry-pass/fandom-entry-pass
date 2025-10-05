// api/connect/account-status.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const account = (req.query?.account || req.query?.accountId || "").toString().trim();
  if (!account) return res.status(400).json({ error: "Missing account" });

  try {
    const acc = await stripe.accounts.retrieve(account);

    // Core flags your UI cares about
    const charges_enabled = !!acc.charges_enabled;
    const payouts_enabled = !!acc.payouts_enabled;
    const details_submitted = !!acc.details_submitted;

    // Optional: show what’s still required (useful for debugging “Needs info”)
    const requirements = acc.requirements || {};

    return res.status(200).json({
      ok: true,
      account: acc.id,
      charges_enabled,
      payouts_enabled,
      details_submitted,
      requirements, // includes current_deadline, disabled_reason, past_due, pending_verification, etc.
    });
  } catch (err) {
    console.error("account-status error:", err);
    // Bubble up 404s if the account id is wrong
    if (err?.statusCode === 404) return res.status(404).json({ error: "Account not found" });
    return res.status(500).json({ error: "Failed to retrieve account status" });
  }
}
