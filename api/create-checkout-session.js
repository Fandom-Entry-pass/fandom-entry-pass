// api/create-checkout-session.js
import Stripe from "stripe";

export const config = { runtime: "nodejs" };
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ==== env / defaults (in cents where applicable) ====
const APP_BASE_URL         = process.env.APP_BASE_URL || "";
const BUYER_FEE_CENTS_ENV  = process.env.BUYER_FEE_CENTS;      // e.g. "350"
const ESCROW_HOURS         = Number(process.env.ESCROW_HOURS ?? 72);
const SELLER_FEE_FIXED_ENV = process.env.SELLER_FEE_FIXED;     // e.g. "75"
const SELLER_FEE_PCT_ENV   = process.env.SELLER_FEE_PERCENT;   // e.g. "0.05" or "5"
const MAX_QTY_PER_ORDER    = Number(process.env.MAX_QTY_PER_ORDER ?? 10);

// sane defaults if env missing
const BUYER_FEE_CENTS  = Number.isFinite(Number(BUYER_FEE_CENTS_ENV))  ? Number(BUYER_FEE_CENTS_ENV)  : 350;
const SELLER_FEE_FIXED = Number.isFinite(Number(SELLER_FEE_FIXED_ENV)) ? Number(SELLER_FEE_FIXED_ENV) : 75;

// "5" -> 0.05  // "0.05" -> 0.05
function normalizePercent(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? n / 100 : n;
}
const SELLER_FEE_PCT = normalizePercent(SELLER_FEE_PCT_ENV ?? 0.05);

// helpers
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

  // prevent caching
  res.setHeader("Cache-Control", "no-store");

  try {
    const {
      listingId, group, date, city, seat,
      face, price, qty = 1,
      sellerEmail, buyerEmail = "", sellerAccountId = ""
    } = req.body || {};

    if (!listingId) return res.status(400).json({ error: "Missing listingId" });
    if (!sellerAccountId) {
      return res.status(400).json({ error: "Missing sellerAccountId (no destination account for payout)" });
    }

    // qty – strictly clamp to sensible range
    let qtyInt = Number(qty);
    if (!Number.isFinite(qtyInt)) qtyInt = parseInt(String(qty), 10);
    qtyInt = Math.max(1, Math.min(MAX_QTY_PER_ORDER, Number.isFinite(qtyInt) ? qtyInt : 1));

    const unitAmount = toCents(price);
    if (unitAmount === null || unitAmount <= 0) {
      return res.status(400).json({ error: "Invalid price" });
    }

    // 15% cap vs face value (if provided)
    if (face !== undefined && face !== null && String(face).trim() !== "") {
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
    if (!origin) return res.status(500).json({ error: "Missing APP_BASE_URL / origin for redirects" });

    // ===== fee math (all cents) =====
    const itemSubtotalCents   = unitAmount * qtyInt;             // tickets only
    const buyerFeeTotalCents  = BUYER_FEE_CENTS * qtyInt;        // fee line item (visible to buyer)
    const grossChargeCents    = itemSubtotalCents + buyerFeeTotalCents;

    // seller platform fee per ticket
    const sellerFeePerTicketCents = Math.round(unitAmount * SELLER_FEE_PCT) + SELLER_FEE_FIXED;
    const sellerFeeTotalCents     = sellerFeePerTicketCents * qtyInt;

    // platform keeps buyer fee + seller fee through application_fee_amount
    let applicationFeeCents       = buyerFeeTotalCents + sellerFeeTotalCents;

    // safety guard: app fee must be < total charge
    if (applicationFeeCents >= grossChargeCents) {
      applicationFeeCents = Math.max(0, grossChargeCents - 1);
    }

    const confirmDeadline = Math.floor(Date.now() / 1000) + ESCROW_HOURS * 3600;

    const payload = {
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual",

        // destination charge so payout goes straight to the seller
        transfer_data: { destination: sellerAccountId },

        // your platform's take
        application_fee_amount: applicationFeeCents,

        // ensures Stripe processing fees are borne by the seller account
        on_behalf_of: sellerAccountId,

        metadata: {
          fep: "1",
          fep_status: "authorized",
          fep_confirm_deadline: String(confirmDeadline),
          listingId,
          group: group || "",
          sellerEmail: sellerEmail || "",
          buyerEmail: buyerEmail || "",
          sellerAccountId,
          face: face !== undefined && face !== null ? String(face) : "",
          price: String(price),
          qty: String(qtyInt),

          // debug echoes
          buyer_fee_cents_per_ticket: String(BUYER_FEE_CENTS),
          buyer_fee_total_cents: String(buyerFeeTotalCents),
          seller_fee_pct: String(SELLER_FEE_PCT),
          seller_fee_fixed_cents: String(SELLER_FEE_FIXED),
          seller_fee_per_ticket_cents: String(sellerFeePerTicketCents),
          seller_fee_total_cents: String(sellerFeeTotalCents),
          application_fee_cents: String(applicationFeeCents),
          item_subtotal_cents: String(itemSubtotalCents),
          gross_charge_cents: String(grossChargeCents)
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
      cancel_url: `${origin}/?canceled=1}`,
      metadata: {
        listingId,
        sellerEmail: sellerEmail || "",
        buyerEmail: buyerEmail || "",
        sellerAccountId,
        qty: String(qtyInt),
        price: String(price),
        face: face !== undefined && face !== null ? String(face) : "",
        // duplicate the echoes outside PI for quick reads
        buyer_fee_cents_per_ticket: String(BUYER_FEE_CENTS),
        buyer_fee_total_cents: String(buyerFeeTotalCents),
        seller_fee_per_ticket_cents: String(sellerFeePerTicketCents),
        seller_fee_total_cents: String(sellerFeeTotalCents),
        application_fee_cents: String(applicationFeeCents),
        item_subtotal_cents: String(itemSubtotalCents),
        gross_charge_cents: String(grossChargeCents),
        fep_confirm_deadline: String(confirmDeadline)
      }
    };

    const session = await stripe.checkout.sessions.create(payload, {
      idempotencyKey: `checkout:${listingId}:${buyerEmail || "anon"}:${Date.now()}:${Math.random()
        .toString(36)
        .slice(2)}`
    });

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
      qtyEcho: qtyInt,
      feeEcho: {
        sellerFeePerTicketCents,
        sellerFeeTotalCents,
        buyerFeeTotalCents,
        applicationFeeCents,
        itemSubtotalCents,
        grossChargeCents
      },
      lineItemsEcho: payload.line_items.map(li => ({
        unit_amount: li.price_data.unit_amount,
        quantity: li.quantity
      }))
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}
