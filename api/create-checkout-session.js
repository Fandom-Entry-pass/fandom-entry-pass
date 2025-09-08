const { json } = require('micro');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end('Method Not Allowed');
    return;
  }
  try {
    const body = await json(req);
    const {
      listingId,
      group,
      date,
      city,
      seat,
      price,
      qty,
      sellerEmail,
      buyerEmail
    } = body || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_intent_data: { capture_method: 'manual' },
      line_items: [
        {
          quantity: qty || 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round((price || 0) * 100),
            product_data: {
              name: group || 'Listing',
              description: [date, city, seat].filter(Boolean).join(' • ')
            }
          }
        }
      ],
      customer_email: buyerEmail || undefined,
      metadata: { listingId, sellerEmail },
      success_url: `${process.env.APP_BASE_URL}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL}?canceled=true`
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sessionId: session.id }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
};
