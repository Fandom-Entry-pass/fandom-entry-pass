const express = require('express');
const Stripe = require('stripe');
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');

sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

const app = express();
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

const notify = async (intent, status) => {
  const { buyerEmail, sellerEmail, adminEmail } = intent.metadata || {};
  const emails = [buyerEmail, sellerEmail, adminEmail].filter(Boolean);
  if (!emails.length) return;
  const msg = {
    to: emails,
    from: process.env.FROM_EMAIL,
    subject: `Payment ${status}`,
    text: `Payment ${intent.id} is now ${status}.`,
  };
  try {
    await sgMail.send(msg);
  } catch (err) {
    console.error('Email error', err);
  }
};

const pending = new Map();

function scheduleAutoCapture(intent) {
  const id = intent.id;
  if (pending.has(id)) return;
  const timeout = setTimeout(async () => {
    try {
      const pi = await stripe.paymentIntents.retrieve(id);
      if (pi.status === 'requires_capture') {
        await stripe.paymentIntents.capture(id);
        await notify(pi, 'auto-captured');
      }
    } catch (err) {
      try {
        await stripe.paymentIntents.cancel(id);
        const canceled = await stripe.paymentIntents.retrieve(id);
        await notify(canceled, 'auto-canceled');
      } catch (cancelErr) {
        console.error(cancelErr);
      }
    } finally {
      pending.delete(id);
    }
  }, 72 * 60 * 60 * 1000);
  pending.set(id, timeout);
}

app.post('/webhook', (req, res) => {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const intent = event.data.object;
  switch (event.type) {
    case 'payment_intent.succeeded':
      notify(intent, 'succeeded');
      pending.delete(intent.id);
      break;
    case 'payment_intent.canceled':
      notify(intent, 'canceled');
      pending.delete(intent.id);
      break;
    case 'payment_intent.amount_capturable_updated':
      notify(intent, 'awaiting_capture');
      scheduleAutoCapture(intent);
      break;
    default:
      break;
  }

  res.json({ received: true });
});

// Fallback job in case timers are lost
cron.schedule('0 * * * *', async () => {
  for (const [id] of pending) {
    const created = pending.get(id);
    if (Date.now() - created > 72 * 60 * 60 * 1000) {
      try {
        await stripe.paymentIntents.capture(id);
        const pi = await stripe.paymentIntents.retrieve(id);
        await notify(pi, 'auto-captured');
      } catch (err) {
        await stripe.paymentIntents.cancel(id);
        const canceled = await stripe.paymentIntents.retrieve(id);
        await notify(canceled, 'auto-canceled');
      } finally {
        pending.delete(id);
      }
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));

