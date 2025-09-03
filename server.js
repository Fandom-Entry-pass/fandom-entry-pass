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

    db.run(
      `INSERT INTO orders (id, amount, currency, seller_account_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [intent.id, amount, currency, sellerAccountId, 'requires_capture', Date.now()],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'DB error' });
        }
        res.json({ id: intent.id, clientSecret: intent.client_secret });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Capture funds
app.post('/api/orders/:id/capture', async (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM orders WHERE id = ?', [id], async (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const age = Date.now() - order.created_at;
    if (age > 72 * 60 * 60 * 1000) {
      try {
        await stripe.paymentIntents.cancel(id);
        db.run('UPDATE orders SET status = ? WHERE id = ?', ['canceled', id]);
        return res.status(400).json({ error: 'Payment intent expired and canceled' });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    try {
      const intent = await stripe.paymentIntents.capture(id);
      db.run('UPDATE orders SET status = ? WHERE id = ?', ['captured', id]);
      res.json({ status: intent.status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// Cancel and refund
app.post('/api/orders/:id/cancel', async (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM orders WHERE id = ?', [id], async (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    try {
      let result;
      if (order.status === 'captured') {
        result = await stripe.refunds.create({ payment_intent: id });
      } else {
        result = await stripe.paymentIntents.cancel(id);
      }
      db.run('UPDATE orders SET status = ? WHERE id = ?', ['canceled', id]);
      res.json({ status: result.status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
