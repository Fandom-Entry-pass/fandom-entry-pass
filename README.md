# FandomEntryPass App (Frontend)

## Includes
- Frontend PWA: index.html + manifest + service-worker + icons

This repository only contains the frontend portion of FandomEntryPass. Backend API functions and the database schema are not included; you'll need to supply your own implementations compatible with this frontend.

### Webhook Server
- Express server (`server.js`) exposes `/webhook` for Stripe events
- Handles `payment_intent.succeeded`, `payment_intent.canceled`, and `payment_intent.amount_capturable_updated`
- Sends email notifications to buyer, seller, and admin on each event
- Automatically captures or cancels intents after 72 h and notifies parties

## Steps
1. Upload all files to your GitHub repo (root).
2. Connect repo to Vercel → New Project → Framework: Other → Deploy.
3. In Vercel Settings → Environment Variables, add:
   - DATABASE_URL (from Supabase)
   - STRIPE_SECRET_KEY (your Stripe live secret key)
   - STRIPE_WEBHOOK_SECRET (from Stripe dashboard after making webhook)
   - SENDGRID_API_KEY (for transactional emails)
   - FROM_EMAIL (verified sender for emails)
   - FEP_PLATFORM_FEE_FLAT_CENTS = 350
   - FEP_SELLER_FEE_BPS = 500
   - ESCROW_HOURS = 72

5. Your app is live at your Vercel URL. Add to home screen on phones for app experience.

## Frontend Configuration

The frontend reads sensitive values from a runtime configuration file.  Copy
`config.example.js` to `config.js` and provide your own values:

```js
// config.js
window.APP_CONFIG = {
  FORMSPREE: "https://formspree.io/f/your_form_id",
  EMAILJS_PUBLIC: "your_emailjs_public_key",
  EMAILJS_SERVICE: "your_emailjs_service_id",
  EMAILJS_TEMPLATE_SELLER: "template_id_for_seller_notifications",
  EMAILJS_TEMPLATE_BUYER: "template_id_for_buyer_notifications",
  API_BASE: "https://your-backend.example.com",
  STRIPE_PK: "pk_live_your_stripe_publishable_key",
};
```

During deployment you can generate this file automatically by injecting
environment variables. The HTML page simply loads `config.js` and uses the
values from `window.APP_CONFIG`.
