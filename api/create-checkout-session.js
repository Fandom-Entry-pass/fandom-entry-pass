// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

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
      face,                     // face value per ticket (USD)
      price,                    // asking price per ticket (USD)
      qty = 1,
      sellerEmail,
      buyerEmail = "",
      sellerAccountId = ""      // optional: Stripe Connect account id for seller
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

    // Enforce +15% price cap (defense in depth)
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
      return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });
    }

    // Compute order total and seller fee (applied only when using Connect)
    const orderTotalCents = unitAmount * qtyInt;
    const sellerFeeCents = Math.round(orderTotalCents * 0.05) + 50; // 5% + $0.50

    // Build payload
    const payload = {
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
          sellerAccountId: sellerAccountId || "",
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
            product_data: { name, description }
          },
          quantity: qtyInt
        }
        // NOTE: If you add a buyer fee line item ($3.50) on the frontend,
        // keep doing that there—no change needed here.
      ],
      success_url: `${origin}/?success=1&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      // Mirror handy fields at session level
      metadata: {
        listingId,
        sellerEmail: sellerEmail || "",
        buyerEmail: buyerEmail || "",
        sellerAccountId: sellerAccountId || ""
      }
    };

    // Convert to a destination charge if we have a connected seller
    if (sellerAccountId) {
      // Funds route to the seller account
      payload.payment_intent_data.transfer_data = { destination: sellerAccountId };
      // For compliance & correct fee behavior
      payload.payment_intent_data.on_behalf_of = sellerAccountId;
      // Deduct your platform fee from the seller’s payout
      payload.payment_intent_data.application_fee_amount = Math.max(0, sellerFeeCents);
    }

    const session = await stripe.checkout.sessions.create(
      payload,
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

