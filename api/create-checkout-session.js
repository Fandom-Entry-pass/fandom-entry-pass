// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Optional: hard-code your public app base if you prefer; otherwise we’ll use the request origin
const APP_BASE_URL = process.env.APP_BASE_URL || "";

// Flat buyer fee per **order** (in cents)
const BUYER_FEE_CENTS = 350; // $3.50

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
      sellerAccountId = ""      // Stripe Connect account id for seller (optional)
    } = req.body || {};

    // ----- Basic validation -----
    if (!listingId) return res.status(400).json({ error: "Missing listingId" });
    const qtyInt = parseInt(qty, 10);
    if (!qtyInt || qtyInt < 1 || qtyInt > 10) {
      return res.status(400).json({ error: "Invalid qty (1–10)" });
    }
    const unitAmount = toCents(price);
    if (unitAmount === null || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // ----- Enforce +15% cap on ticket price (defense in depth) -----
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

    // ----- Presentation -----
    const name = `${group || "Ticket"} (${qtyInt}x)`;
    const descParts = [];
    if (date) descParts.push(String(date));
    if (city) descParts.push(String(city));
    if (seat) descParts.push(String(seat));
    const description = descParts.join(" • ");

    // ----- Redirect URLs -----
    const origin = APP_BASE_URL || req.headers.origin || "";
    if (!origin) {
      return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });
    }

    // ----- Totals & fees -----
    const ticketSubtotalCents = unitAmount * qtyInt;

    // Seller fee = 5% of ticket subtotal + $0.50 (50¢)
    const sellerFeeCents = Math.round(ticketSubtotalCents * 0.05) + 50;

    // ----- Build Checkout payload -----
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
          qty: String(qtyInt),
          buyer_fee_cents: String(BUYER_FEE_CENTS),
          seller_fee_cents: String(sellerFeeCents)
        }
      },

      // Two line items: tickets + buyer fee
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name, description }
          },
          quantity: qtyInt
        },
        {
          // Buyer Protection Fee (flat $3.50 per order)
          price_data: {
            currency: "usd",
            unit_amount: BUYER_FEE_CENTS,
            product_data: {
              name: "Buyer Protection Fee",
              description: "Covers escrow, support, and platform services"
            }
          },
          quantity: 1
        }
      ],

      success_url: `${origin}/?success=1&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,

      // Mirror a few fields at session level
      metadata: {
        listingId,
        sellerEmail: sellerEmail || "",
        buyerEmail: buyerEmail || "",
        sellerAccountId: sellerAccountId || "",
        buyer_fee_cents: String(BUYER_FEE_CENTS),
        seller_fee_cents: String(sellerFeeCents)
      }
    };

    // If a seller is connected, route funds and apply seller fee
    if (sellerAccountId) {
      payload.payment_intent_data.transfer_data = { destination: sellerAccountId };
      payload.payment_intent_data.on_behalf_of = sellerAccountId;
      payload.payment_intent_data.application_fee_amount = Math.max(0, sellerFeeCents);
    }
    // If no sellerAccountId, funds settle on your platform account (no application fee).

    const session = await stripe.checkout.sessions.create(
      payload,
      {
        // Idempotency helps prevent duplicates on retries
        idempotencyKey: `checkout:${listingId}:${buyerEmail}:${Date.now()}`
      }
    );

    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}
