# FandomEntryPass App (Frontend + Backend)

## Includes
- Frontend PWA: index.html + manifest + service-worker + icons
- Backend API: Vercel serverless functions in /api
- Database schema: schema.sql

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

### Development

```bash
npm install
npm start
```
4. In Supabase → SQL Editor → paste schema.sql → Run.
5. Your app is live at your Vercel URL. Add to home screen on phones for app experience.
