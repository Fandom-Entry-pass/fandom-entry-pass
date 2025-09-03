# FandomEntryPass App (Frontend)

## Includes
- Frontend PWA: index.html + manifest + service-worker + icons

This repository only contains the frontend portion of FandomEntryPass. Backend API functions and the database schema are not included; you'll need to supply your own implementations compatible with this frontend.

## Steps
1. Upload all files to your GitHub repo (root).
2. Connect repo to Vercel → New Project → Framework: Other → Deploy.
3. In Vercel Settings → Environment Variables, add:
   - SUPABASE_URL (from Supabase project)
   - SUPABASE_SERVICE_KEY (service role key)
   - ADMIN_TOKEN (secret for admin approval API)
   - STRIPE_SECRET_KEY (your Stripe live secret key)
   - STRIPE_WEBHOOK_SECRET (from Stripe dashboard after making webhook)
   - FEP_PLATFORM_FEE_FLAT_CENTS = 350
   - FEP_SELLER_FEE_BPS = 500
   - ESCROW_HOURS = 72

