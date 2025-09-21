// api/connect/account-status.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Frontend calls ?account=acct_... (we also accept accountId for flexibility)
  const accountParam = req.query.account || req.query.accountId;
  if (!accountParam) return res.status(400).json({ error: "Missing account" });

  try {
    const account = await stripe.accounts.retrieve(accountParam);

    return res.status(200).json({
      ok: true,
      account: account.id,
      charges_enabled: !!account.charges_enabled,
      payouts_enabled: !!account.payouts_enabled,
      details_submitted: !!account.details_submitted,
      requirements: account.requirements || null,
    });
  } catch (err) {
    console.error("account-status error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
