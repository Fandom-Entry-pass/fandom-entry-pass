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
4. Ensure your deployment includes backend endpoints under `/api`, serves the frontend via Express static middleware (e.g., `app.use(express.static(__dirname))` so `/` returns `index.html`), and a database schema matching your environment variables.
5. Your app is live at your Vercel URL. Add to home screen on phones for app experience.

## Frontend Configuration

The frontend reads sensitive values from a runtime configuration file.  Copy
`config.example.js` to `config.js` and provide your own values:

```js
// config.js
window.APP_CONFIG = {
  FORMSPREE: "https://formspree.io/f/mvgqedqo",
  EMAILJS_PUBLIC: "PioDqOAQEpgJXFr7G",
  EMAILJS_SERVICE: "service_FEP0",
  EMAILJS_TEMPLATE_SELLER: "template_SellerNots",
  EMAILJS_TEMPLATE_BUYER: "template_BuyerNots",
  API_BASE: "https://fandom-entry-pass-kmj3be28f-alexisdeshong-9388s-projects.vercel.app",
  STRIPE_PK: "pk_live_51LcNBuF7BMVtRlnacvmpKOmS9gMBg3IOnkdgaOjdRjCCspQNjHuvPBwLXBdxIn2qC0bJpa1yO2GZjaTbMOvwvr7n00sb6AKo1u",
};
```

During deployment you can generate this file automatically by injecting
environment variables. The HTML page simply loads `config.js` and uses the
values from `window.APP_CONFIG`.
