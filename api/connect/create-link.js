// api/connect/create-link.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` ||
  "http://localhost:3000";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", "POST, GET");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Accept both JSON body (POST) and querystring (GET) for convenience
    const body = req.method === "POST" ? (req.body || {}) : req.query || {};
    const sellerEmail = (body.sellerEmail || body.email || "").toString().trim();
    const sellerName  = (body.sellerName || "").toString().trim();
    let   accountId   = (body.accountId || body.account || "").toString().trim();

    // If accountId is provided, verify it exists; otherwise create one
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
      } catch (e) {
        // If the passed account id is bogus, ignore it and fall back to creating a new account
        accountId = "";
      }
    }

    if (!accountId) {
      // 🔐 Create an Express account.
      // The controller.* fields are REQUIRED on new API versions to declare responsibilities.
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",           // Change if you need multi-country onboarding
        email: sellerEmail || undefined,
        business_profile: {
          product_description: "Fan ticket resale via FandomEntryPass",
          support_email: sellerEmail || undefined,
        },
        // ✅ Declare who pays fees & who covers losses (payments disputes/refunds).
        controller: {
          fees:   { payer: "application" },     // your platform collects fees
          losses: { payments: "application" },  // your platform accepts liability for losses
        },
        // Common capabilities for payouts and charges
        capabilities: {
          transfers:       { requested: true },
          card_payments:   { requested: true },
        },
        metadata: {
          fep_seller_email: sellerEmail || "",
          fep_seller_name: sellerName || "",
        },
      });

      accountId = account.id;
    }

    // Create an onboarding or update link
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
    // Surface Stripe’s message to help debugging in the UI
    return res.status(status).json({
      ok: false,
      error: err?.message || "Failed to create account link",
    });
  }
}

