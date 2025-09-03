const Stripe = require('stripe');
const db = require('./db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const ESCROW_HOURS = parseInt(process.env.ESCROW_HOURS || '72', 10);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { amount, currency, sellerAccountId, buyerId, description } =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const flatFee = parseInt(process.env.FEP_PLATFORM_FEE_FLAT_CENTS || '0', 10);
    const sellerFeeBps = parseInt(process.env.FEP_SELLER_FEE_BPS || '0', 10);
    const applicationFee = flatFee + Math.floor((amount * sellerFeeBps) / 10000);

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      capture_method: 'manual',
      application_fee_amount: applicationFee,
      transfer_data: { destination: sellerAccountId },
      description,
    });

    const captureAt = new Date(Date.now() + ESCROW_HOURS * 3600 * 1000);

    const insertText =
      'INSERT INTO orders(payment_intent_id, amount, currency, seller_account, buyer_id, status, capture_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id';
    const insertValues = [
      paymentIntent.id,
      amount,
      currency,
      sellerAccountId,
      buyerId,
      'requires_capture',
      captureAt,
    ];
    const { rows } = await db.query(insertText, insertValues);

    res.status(200).json({
      orderId: rows[0].id,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
