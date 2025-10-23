// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const APP_BASE_URL       = process.env.APP_BASE_URL || "";
const BUYER_FEE_CENTS    = Number(process.env.BUYER_FEE_CENTS   || 350);
const ESCROW_HOURS       = Number(process.env.ESCROW_HOURS      || 72);
const SELLER_FEE_FIXED   = Number(process.env.SELLER_FEE_FIXED  || 75);
const SELLER_FEE_PERCENT = Number(process.env.SELLER_FEE_PERCENT|| 0.05);
const MAX_QTY_PER_ORDER  = Number(process.env.MAX_QTY_PER_ORDER || 10);

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

  // prevent any caching along the path
  res.setHeader("Cache-Control", "no-store");

  try {
    const {
      listingId, group, date, city, seat,
      face, price, qty = 1,
      sellerEmail, buyerEmail = "", sellerAccountId = ""
    } = req.body || {};

    if (!listingId) return res.status(400).json({ error: "Missing listingId" });

    // buyer-selected qty (NOT listing.remaining)
    let qtyInt = Number(qty);
    if (!Number.isFinite(qtyInt)) qtyInt = parseInt(String(qty), 10);
    qtyInt = Math.max(1, Math.min(MAX_QTY_PER_ORDER, Number.isFinite(qtyInt) ? qtyInt : 1));

    const unitAmount = toCents(price);
    if (unitAmount === null || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // 15% cap vs. (optional) face value
    if (face !== undefined && face !== null && face !== "") {
      const faceCents = toCents(face);
      if (faceCents && unitAmount > Math.round(faceCents * 1.15)) {
        return res.status(400).json({ error: "Price exceeds +15% cap" });
      }
    }

    const name = String(group || "Ticket");
    const descParts = [];
    if (date) descParts.push(String(date));
    if (city) descParts.push(String(city));
    if (seat) descParts.push(String(seat));
    const description = descParts.join(" • ");

    const origin = APP_BASE_URL || req.headers.origin || "";
    if (!origin) {
      return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });
    }

    // fees computed per-ticket
    const sellerFeePerTicketCents = Math.round(unitAmount * SELLER_FEE_PERCENT) + SELLER_FEE_FIXED;
    const sellerFeeTotalCents     = sellerFeePerTicketCents * qtyInt;
    const buyerFeeTotalCents      = BUYER_FEE_CENTS * qtyInt;
    const platformFeeTotalCents   = sellerFeeTotalCents + buyerFeeTotalCents; // 👈 your platform’s take
    const confirmDeadline         = Math.floor(Date.now() / 1000) + ESCROW_HOURS * 3600;

    // NOTE: Ideal place for a server-side inventory check (ensure qtyInt <= remaining in DB).

    const payload = {
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual",
        // application_fee_amount will be injected below ONLY for Direct Charges (when sellerAccountId is present)
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
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: { name, description }
          },
          quantity: qtyInt // ← buyer-selected quantity
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
          quantity: qtyInt
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

    // --- Create the Checkout Session ---
    // If sellerAccountId exists, run a Direct Charge on the connected account,
    // set application_fee_amount so your platform receives buyer + seller fees,
    // and the connected account pays Stripe’s processing fees.
    let session;

    if (sellerAccountId) {
      // inject application_fee_amount for Direct Charge
      payload.payment_intent_data.application_fee_amount = platformFeeTotalCents;

      session = await stripe.checkout.sessions.create(
        payload,
        {
          stripeAccount: sellerAccountId, // Direct Charge on connected account
          idempotencyKey: `checkout:${listingId}:${sellerAccountId}:${qtyInt}:${Date.now()}:${Math.random().toString(36).slice(2)}`
        }
      );
    } else {
      // fallback: create on platform account (no split)
      session = await stripe.checkout.sessions.create(
        payload,
        {
          idempotencyKey: `checkout:${listingId}:${qtyInt}:${Date.now()}:${Math.random().toString(36).slice(2)}`
        }
      );
    }

    // Return url so the client can redirect immediately
    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
      qtyEcho: qtyInt,
      lineItemsEcho: payload.line_items.map(li => ({
        unit_amount: li.price_data.unit_amount,
        quantity: li.quantity
      })),
      usedDirectCharge: !!sellerAccountId,
      platformFeeTotalCents
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}

