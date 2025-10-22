// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// Optional: hard-code your public app base if you prefer; otherwise we’ll use the request origin
const APP_BASE_URL = process.env.APP_BASE_URL || "";

/**
 * Expected env / config:
 * - BUYER_FEE_CENTS        // per-ticket buyer fee in cents (e.g., 350)
 * - ESCROW_HOURS           // escrow window in hours (e.g., 72)
 * - SELLER_FEE_FIXED       // per-ticket fixed seller fee in cents (e.g., 75)
 * - SELLER_FEE_PERCENT     // per-ticket percent as decimal (e.g., 0.05)
 */
const BUYER_FEE_CENTS = Number(process.env.BUYER_FEE_CENTS || 350);
const ESCROW_HOURS = Number(process.env.ESCROW_HOURS || 72);
const SELLER_FEE_FIXED = Number(process.env.SELLER_FEE_FIXED || 75);
const SELLER_FEE_PERCENT = Number(process.env.SELLER_FEE_PERCENT || 0.05);

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

    if (!listingId) return res.status(400).json({ error: "Missing listingId" });

    // Robust qty parse (accepts number or string)
    let qtyInt = Number(qty);
    if (!Number.isFinite(qtyInt)) qtyInt = parseInt(String(qty), 10);
    qtyInt = Math.max(1, Math.min(10, Number.isFinite(qtyInt) ? qtyInt : 1));

    const unitAmount = toCents(price);
    if (unitAmount === null || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // Enforce +15% cap on ticket price (per ticket)
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

    // Presentation
    const name = `${group || "Ticket"} (${qtyInt}x)`;
    const descParts = [];
    if (date) descParts.push(String(date));
    if (city) descParts.push(String(city));
    if (seat) descParts.push(String(seat));
    const description = descParts.join(" • ");

    // Redirect URLs
    const origin = APP_BASE_URL || req.headers.origin || "";
    if (!origin) {
      return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });
    }

    // Fees per ticket
    const sellerFeePerTicketCents = Math.round(unitAmount * SELLER_FEE_PERCENT) + SELLER_FEE_FIXED;
    const sellerFeeTotalCents = sellerFeePerTicketCents * qtyInt;
    const buyerFeeTotalCents = BUYER_FEE_CENTS * qtyInt;

    // Escrow deadline
    const confirmDeadline = Math.floor(Date.now() / 1000) + ESCROW_HOURS * 3600;

    // Build Checkout payload
    const payload = {
      mode: "payment",

      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          fep: "1",
          fep_status: "authorized",
          fep_confirm_deadline: String(confirmDeadline),
          listingId,
          group: group || "",
          sellerEmail: sellerEmail || "",
          buyerEmail: buyerEmail || "",
          sellerAccountId: sellerAccountId || "",
          face: face !== undefined && face !== null ? String(face) : "",
          price: String(price),
          qty: String(qtyInt),
          buyer_fee_cents_per_ticket: String(BUYER_FEE_CENTS),
          buyer_fee_total_cents: String(buyerFeeTotalCents),
          seller_fee_per_ticket_cents: String(sellerFeePerTicketCents),
          seller_fee_total_cents: String(sellerFeeTotalCents)
        }
      },

      // Tickets + buyer fee (both per ticket), with adjustable quantity enabled
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name, description }
          },
          quantity: qtyInt,
          adjustable_quantity: { enabled: true, minimum: 1, maximum: Math.max(qtyInt, 10) } // show qty control in Checkout
        },
        {
          price_data: {
            currency: "usd",
            unit_amount: BUYER_FEE_CENTS,
            product_data: {
              name: "Service Fee (per ticket)",
              description: "Covers escrow and platform services"
            }
          },
          quantity: qtyInt,
          adjustable_quantity: { enabled: false } // keep fee tied to ticket qty
        }
      ],

      customer_email: buyerEmail || undefined,

      success_url: `${origin}/?success=1&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,

      metadata: {
        listingId,
        sellerEmail: sellerEmail || "",
        buyerEmail: buyerEmail || "",
        sellerAccountId: sellerAccountId || "",
        qty: String(qtyInt),
        price: String(price),
        face: face !== undefined && face !== null ? String(face) : "",
        buyer_fee_cents_per_ticket: String(BUYER_FEE_CENTS),
        buyer_fee_total_cents: String(buyerFeeTotalCents),
        seller_fee_per_ticket_cents: String(sellerFeePerTicketCents),
        seller_fee_total_cents: String(sellerFeeTotalCents),
        fep_confirm_deadline: String(confirmDeadline)
      }
    };

    const session = await stripe.checkout.sessions.create(
      payload,
      {
        // ensure different qty creates a new session instead of reusing an old one
        idempotencyKey: `checkout:${listingId}:${buyerEmail}:${qtyInt}:${unitAmount}:${BUYER_FEE_CENTS}:${sellerFeePerTicketCents}`
      }
    );

    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}

