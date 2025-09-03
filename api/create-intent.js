export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { amount } = req.body || {};
    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        amount: String(amount || 0),
        currency: 'usd',
        capture_method: 'manual',
        'automatic_payment_methods[enabled]': 'true'
      })
    });
    const data = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(data.error?.message || 'Stripe error');
    res.status(200).json({ clientSecret: data.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
