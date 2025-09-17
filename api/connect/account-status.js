// api/connect/account-status.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: "Missing accountId" });

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const payoutsEnabled = account.payouts_enabled;
    const detailsSubmitted = account.details_submitted;
    const requirements = account.requirements;

    return res.status(200).json({
      ok: true,
      accountId: account.id,
      payoutsEnabled,
      detailsSubmitted,
      requirements,
    });
  } catch (err) {
    console.error("account-status error:", err);
    return res.status(500).json({ error: err.message });
  }
}
