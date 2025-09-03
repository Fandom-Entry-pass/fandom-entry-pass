const Stripe = require('stripe');
const db = require('./db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { rows } = await db.query(
      'SELECT id, payment_intent_id FROM orders WHERE status = $1 AND capture_at <= now()',
      ['requires_capture']
    );

    for (const row of rows) {
      try {
        await stripe.paymentIntents.capture(row.payment_intent_id);
        await db.query(
          'UPDATE orders SET status = $2, captured_at = now() WHERE id = $1',
          [row.id, 'captured']
        );
      } catch (err) {
        console.error('Failed to capture intent', row.payment_intent_id, err.message);
      }
    }

    res.status(200).json({ captured: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
