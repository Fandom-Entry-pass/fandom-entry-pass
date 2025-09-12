import Stripe from "stripe";

// use your live secret; set it in Vercel → Settings → Environment Variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// optional: set APP_BASE_URL in Vercel; otherwise same-origin will be fine for redirect
const APP_BASE_URL = process.env.APP_BASE_URL || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      listingId,
      group, date, city, seat,
      face, price, qty = 1,
      sellerEmail, buyerEmail = ""
    } = req.body || {};

    if (!listingId || !price || !qty) {
      return res.status(400).json({ error: "Missing listingId, price, or qty" });
    }

    const unitAmount = Math.round(Number(price) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: `${group || "Ticket"} (${qty}x)`,
            description: `${date || ""}${city ? " • " + city : ""}${seat ? " • " + seat : ""}`.trim(),
          },
        },
        quantity: qty,
      }],
      // escrow: authorize only; capture later (/api/confirm-received)
      payment_intent_data: {
        capture_method: "manual",
        metadata: {
          fep: "1", // ✅ helps cron/webhook find these
          listingId,
          group: group || "",
          sellerEmail: sellerEmail || "",
          buyerEmail: buyerEmail || "",
          face: String(face || ""),
          price: String(price || ""),
          qty: String(qty),
        },
      },
      success_url: (APP_BASE_URL || req.headers.origin) + `/?success=1&sid={CHECKOUT_SESSION_ID}`,
      cancel_url: (APP_BASE_URL || req.headers.origin) + `/?canceled=1`,
      metadata: { listingId, sellerEmail: sellerEmail || "", buyerEmail: buyerEmail || "" },
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Internal error creating session" });
  }
}

