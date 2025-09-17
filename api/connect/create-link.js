// api/connect/create-link.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Create or retrieve seller account
    const account = await stripe.accounts.create({
      type: "express",
    });

    // Create onboarding link
    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${req.headers.origin}/seller-dashboard?refresh=1`,
      return_url: `${req.headers.origin}/seller-dashboard?connected=1`,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: link.url });
  } catch (err) {
    console.error("create-link error:", err);
    return res.status(500).json({ error: err.message });
  }
}
