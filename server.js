const express = require('express');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PLATFORM_FEE_PERCENT = 0.1; // 10%

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
  const {
    listingId,
    price,
    qty = 1,
    group,
    date,
    city,
    seat,
    sellerEmail,
    buyerEmail
  } = req.body || {};

  const amount = Number(price);
  const quantity = Number(qty);

  if (!listingId || !amount || amount <= 0 || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ error: 'listingId, positive price, and quantity are required' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: group || 'Listing',
              metadata: { listingId, date, city, seat }
            }
          },
          quantity
        }
      ],
      metadata: { listingId, sellerEmail, buyerEmail },
      success_url: `${req.headers.origin}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/?canceled=true`
    });

    res.json({ sessionId: session.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}


// Create order and PaymentIntent
app.post('/api/orders', async (req, res) => {
  const { amount, currency = 'usd', sellerAccountId } = req.body;
  if (!amount || !sellerAccountId) {
    return res.status(400).json({ error: 'amount and sellerAccountId required' });
  }

  try {
    const applicationFee = Math.round(amount * PLATFORM_FEE_PERCENT);
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      capture_method: 'manual',
      application_fee_amount: applicationFee,
      transfer_data: { destination: sellerAccountId }
    });

    await db.createOrder({
      id: intent.id,
      amount,
      currency,
      sellerAccountId,
      status: 'requires_capture',
      createdAt: Date.now(),
    });
    res.json({ id: intent.id, clientSecret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Capture funds
app.post('/api/orders/:id/capture', async (req, res) => {
  const { id } = req.params;
  try {
    const order = await db.getOrder(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const age = Date.now() - order.created_at;
    if (age > 72 * 60 * 60 * 1000) {
      try {
        await stripe.paymentIntents.cancel(id);
        await db.updateOrderStatus(id, 'canceled');
        return res.status(400).json({ error: 'Payment intent expired and canceled' });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    try {
      const intent = await stripe.paymentIntents.capture(id);
      await db.updateOrderStatus(id, 'captured');
      res.json({ status: intent.status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel and refund
app.post('/api/orders/:id/cancel', async (req, res) => {
  const { id } = req.params;
  try {
    const order = await db.getOrder(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    try {
      let result;
      if (order.status === 'captured') {
        result = await stripe.refunds.create({ payment_intent: id });
      } else {
        result = await stripe.paymentIntents.cancel(id);
      }
      await db.updateOrderStatus(id, 'canceled');
      res.json({ status: result.status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
