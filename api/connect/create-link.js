// api/connect/create-link.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const ORIGIN =
  process.env.APP_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://fandom-entry-pass.vercel.app");

export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", "POST, GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Accept JSON body (POST) or query (GET)
    const body = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const sellerEmail = (body.sellerEmail || body.email || "").toString().trim();
    const sellerName  = (body.sellerName || "").toString().trim();
    let accountId     = (body.accountId || body.account || "").toString().trim();

    // If an account was passed in, verify it exists; otherwise, we'll create one.
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
      } catch {
        accountId = ""; // invalid id -> create a fresh one
      }
    }

    if (!accountId) {
      // ✅ Create a platform-controlled account (no `type`).
      // Must declare responsibilities explicitly via `controller.*`.
      const account = await stripe.accounts.create({
        country: "US", // change if needed
        email: sellerEmail || undefined,
        business_profile: {
          product_description: "Fan ticket resale via FandomEntryPass",
          support_email: sellerEmail || undefined,
        },
        controller: {
          fees:   { payer: "application" },     // your platform collects/owes application fees
          losses: { payments: "application" },  // your platform is responsible for payments losses
        },
        capabilities: {
          transfers:     { requested: true },
          card_payments: { requested: true },
        },
        metadata: {
          fep_seller_email: sellerEmail || "",
          fep_seller_name: sellerName || "",
        },
      });

      accountId = account.id;
    }

    // Hosted onboarding link still works with controller-style accounts
    const refresh_url = `${ORIGIN}/?account=${encodeURIComponent(accountId)}#stripe-refresh`;
    const return_url  = `${ORIGIN}/?account=${encodeURIComponent(accountId)}#stripe-return`;

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return res.status(200).json({
      ok: true,
      status: "onboarding",
      accountId,
      url: link.url,
    });
  } catch (err) {
    console.error("create-link error:", err);
    const status = err?.statusCode || 400;
    return res.status(status).json({
      ok: false,
      error: err?.message || "Failed to create account link",
    });
  }
}
