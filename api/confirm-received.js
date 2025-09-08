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
    const { sessionId } = await json(req);
    if (!sessionId) throw new Error('sessionId required');

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paymentIntent = session.payment_intent;
    if (!paymentIntent) throw new Error('Payment Intent not found');

    await stripe.paymentIntents.capture(paymentIntent);

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
};
