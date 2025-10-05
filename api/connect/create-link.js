// /api/connect/create-link.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

function originFrom(req) {
  const fromEnv = process.env.APP_ORIGIN && process.env.APP_ORIGIN.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const hdr = (req.headers["origin"] || req.headers["referer"] || "").toString();
  if (hdr) return hdr.replace(/\/+$/, "");
  return "http://localhost:3000";
}

function allowCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

async function readJson(req) {
  return await new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  allowCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY on server." });
  }

  const body = req.method === "POST" ? await readJson(req) : {};
  const q = req.query || {};

  const sellerEmail = String(body.sellerEmail || q.sellerEmail || "").trim();
  const sellerName  = String(body.sellerName  || q.sellerName  || "").trim();
  let accountId     = String(body.accountId   || body.account  || q.accountId || q.account || "").trim();

  try {
    const origin = originFrom(req);

    // 1) Create an Express account if we don't have one yet
    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        email: sellerEmail || undefined,
        metadata: { sellerEmail: sellerEmail || "", sellerName: sellerName || "" }
      });
      accountId = acct.id;
    }

    // 2) Retrieve current account state
    const acct = await stripe.accounts.retrieve(accountId);

    // 3) If onboarding still needed, send onboarding link
    if (!acct.charges_enabled || !acct.payouts_enabled) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        return_url: `${origin}/?account=${accountId}`,
        refresh_url: `${origin}/?account=${accountId}&reconnect=1`,
      });
      return res.status(200).json({ ok: true, status: "onboarding", accountId, url: link.url });
    }

    // 4) Already connected → dashboard login link
    const login = await stripe.accounts.createLoginLink(accountId);
    return res.status(200).json({ ok: true, status: "connected", accountId, url: login.url });

  } catch (err) {
    console.error("create-link error:", err);
    const msg = err?.message || "Unknown error";
    // If account param is invalid, surface 400 so the UI can retry without it
    return res.status(400).json({ ok: false, error: msg });
  }
}

