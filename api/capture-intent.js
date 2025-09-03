export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { paymentIntentId } = req.body || {};
    const stripeRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    const data = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(data.error?.message || 'Stripe error');
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
