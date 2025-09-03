# FandomEntryPass App (Frontend + Backend)

## Includes
- Frontend PWA: index.html + manifest + service-worker + icons
- Backend API: Vercel serverless functions in /api
- Database schema: schema.sql

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
4. In Supabase → SQL Editor → paste schema.sql → Run. Also create a storage bucket named `proofs` for uploaded ticket images.
5. Your app is live at your Vercel URL. Add to home screen on phones for app experience.

## Admin Approval
Listings submitted by sellers are stored with `status = pending` and are not shown to buyers until approved. Approve a listing via:
```
POST /api/admin/approve
Authorization: Bearer <ADMIN_TOKEN>
Body: { "id": "<listing-id>" }
```
Approved listings are returned by `GET /api/listings`.
