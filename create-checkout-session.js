// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs18.x" };

// Live secret should be set in Vercel → Settings → Environment Variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Optional: set APP_BASE_URL in Vercel; otherwise we’ll fall back to the request origin
const APP_BASE_URL = process.env.APP_BASE_URL || "";

function toCents(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      listingId,
      group,
      date,
      city,
      seat,
      face,                // face value per ticket (USD)
      price,               // asking price per ticket (USD)
      qty = 1,
      sellerEmail,
      buyerEmail = ""
    } = req.body || {};

    // Basic validation
    if (!listingId) return res.status(400).json({ error: "Missing listingId" });
    const qtyInt = parseInt(qty, 10);
    if (!qtyInt || qtyInt < 1 || qtyInt > 10) {
      return res.status(400).json({ error: "Invalid qty (1–10)" });
    }
    const unitAmount = toCents(price);
    if (unitAmount === null || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // Enforce +15% price cap on the backend too (never trust only the UI)
    if (face !== undefined && face !== null && face !== "") {
      const faceCents = toCents(face);
      if (faceCents !== null && faceCents > 0) {
        const cap = Math.round(faceCents * 1.15);
        if (unitAmount > cap) {
          return res.status(400).json({
            error: "Price exceeds +15% cap",
            details: { max_per_ticket_usd: (cap / 100).toFixed(2) }
          });
        }
      }
    }

    const name = `${group || "Ticket"} (${qtyInt}x)`;
    const descParts = [];
    if (date) descParts.push(String(date));
    if (city) descParts.push(String(city));
    if (seat) descParts.push(String(seat));
    const description = descParts.join(" • ");

    // Determine success/cancel URLs (prefer APP_BASE_URL, else request origin)
    const origin = APP_BASE_URL || req.headers.origin || "";
    if (!origin) {
      // If somehow neither exists, fail fast to avoid bad redirect URLs
      return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Escrow: authorize only; capture later in confirm-received
        payment_intent_data: {
          capture_method: "manual",
          metadata: {
            fep: "1",
            fep_status: "pending",
            listingId,
            group: group || "",
            sellerEmail: sellerEmail || "",
            buyerEmail: buyerEmail || "",
            face: face !== undefined && face !== null ? String(face) : "",
            price: String(price),
            qty: String(qtyInt)
          }
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: unitAmount,
              product_data: {
                name,
                description
              }
            },
            quantity: qtyInt
          }
        ],
        success_url: `${origin}/?success=1&sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?canceled=1`,
        metadata: {
          listingId,
          sellerEmail: sellerEmail || "",
          buyerEmail: buyerEmail || ""
        }
      },
      {
        // Idempotency protects against double-submits / retries
        idempotencyKey: `checkout:${listingId}:${buyerEmail}:${Date.now()}`
      }
    );

    // Frontend expects sessionId (you’re using redirectToCheckout)
    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}
