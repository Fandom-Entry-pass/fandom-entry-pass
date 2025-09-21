// api/connect/create-link.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const origin = req.headers.origin || process.env.APP_BASE_URL || "";
    if (!origin) return res.status(500).json({ error: "Missing origin/APP_BASE_URL" });

    const { sellerEmail = "", sellerName = "", accountId = "" } = (req.body || {});

    // Reuse an existing account if provided, otherwise create a new Express account
    let account;
    if (accountId) {
      account = await stripe.accounts.retrieve(accountId);
    } else {
      account = await stripe.accounts.create({
        type: "express",
        email: sellerEmail || undefined,
        business_profile: sellerName ? { name: sellerName } : undefined,
      });
    }

    // Create an onboarding link that returns with query flags your UI listens for
    const link = await stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      refresh_url: `${origin}/?onboarded=0&account=${encodeURIComponent(account.id)}`,
      return_url:  `${origin}/?onboarded=1&account=${encodeURIComponent(account.id)}`,
    });

    return res.status(200).json({ url: link.url, accountId: account.id });
  } catch (err) {
    console.error("create-link error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
