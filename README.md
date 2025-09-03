# FandomEntryPass App (Frontend)

## Includes
- Frontend PWA: index.html + manifest + service-worker + icons

This repository only contains the frontend portion of FandomEntryPass. Backend API functions and the database schema are not included; you'll need to supply your own implementations compatible with this frontend.

## Steps
1. Upload all files to your GitHub repo (root).
2. Connect repo to Vercel → New Project → Framework: Other → Deploy.
3. In Vercel Settings → Environment Variables, add:
   - DATABASE_URL (from Supabase)
   - STRIPE_SECRET_KEY (your Stripe live secret key)
   - STRIPE_WEBHOOK_SECRET (from Stripe dashboard after making webhook)
   - FEP_PLATFORM_FEE_FLAT_CENTS = 350
   - FEP_SELLER_FEE_BPS = 500
   - ESCROW_HOURS = 72
4. Ensure your deployment includes backend endpoints under `/api` and a database schema matching your environment variables.
5. Your app is live at your Vercel URL. Add to home screen on phones for app experience.
