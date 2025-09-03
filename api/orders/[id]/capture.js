const Stripe = require('stripe');
const db = require('../../db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  const { id } = req.query;

  try {
    const { rows } = await db.query(
      'SELECT payment_intent_id FROM orders WHERE id = $1 AND status = $2',
      [id, 'requires_capture']
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await stripe.paymentIntents.capture(rows[0].payment_intent_id);
    await db.query('UPDATE orders SET status = $2, captured_at = now() WHERE id = $1', [
      id,
      'captured',
    ]);

    res.status(200).json({ captured: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
