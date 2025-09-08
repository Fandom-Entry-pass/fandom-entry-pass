# FandomEntryPass App

## Includes
- Frontend PWA: `index.html` + manifest + service worker + icons
- Express backend with Stripe checkout and order management endpoints

## Environment Variables
Configure the following variables for the backend:

- `STRIPE_SECRET_KEY` – Stripe secret API key
- `DATABASE_URL` – Postgres connection string (if unset, the app uses local SQLite)
- `STRIPE_WEBHOOK_SECRET` – secret for webhook verification
- `FEP_PLATFORM_FEE_FLAT_CENTS` – platform fee in cents (default `350`)
- `FEP_SELLER_FEE_BPS` – seller fee basis points (default `500`)
- `ESCROW_HOURS` – number of hours funds remain in escrow (default `72`)
- `PORT` – optional HTTP port

## Deployment

1. Upload all files to your GitHub repo.
2. Run `npm install` to install dependencies.
3. Provide the environment variables above (e.g. in Vercel project settings or a `.env` file).
4. Start the server with `npm start` or deploy to your hosting provider. The backend serves the frontend and exposes:
   - `POST /api/create-checkout-session` – create a Stripe Checkout session
   - `POST /api/orders` – create a PaymentIntent and persist order details
   - `POST /api/orders/:id/capture` – capture funds within the escrow window
   - `POST /api/orders/:id/cancel` – cancel or refund an order
5. Access the app at your deployed URL and add to a phone's home screen for a native-like experience.

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
