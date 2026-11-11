# CurlCoco store

A one-product dropshipping store for **shop.deepevolution.za.net**. It's a static site on Cloudflare Pages with Paystack checkout, and it costs **R0 a month** to run. The only cost is Paystack's fee on each sale.

| Part | Tool | Cost |
|---|---|---|
| Hosting, SSL, CDN | Cloudflare Pages (free) | R0 |
| Checkout API | Pages Functions (Workers free plan: 100k requests a day) | R0 |
| Order deduplication | Workers KV (free plan) | R0 |
| Payments | Paystack: card 2.9% + R1, EFT/Capitec Pay 2% (ex VAT) | per sale |
| Email | Brevo free plan (300 emails a day) | R0 |
| Analytics | Cloudflare Web Analytics (no cookies) | R0 |

Lighthouse (mobile, local): Performance 100, Accessibility 100, Best Practices 100, SEO 100.

## How an order flows

1. The shopper adds the set to the cart, enters a delivery address and accepts the Terms.
2. `POST /api/checkout` sets the price **on the server** from `site.config.json`, starts a Paystack transaction (with the address stored in its metadata) and redirects the shopper to Paystack.
3. After payment, Paystack sends the shopper back to `/order-confirmed`, which calls `/api/verify`.
4. Paystack calls `POST /api/paystack-webhook`. The webhook checks the HMAC-SHA512 signature, re-checks the payment with Paystack, and then emails **you** (address + checklist) and **the customer** (confirmation). This happens once per order, thanks to the KV store.
5. You place the order on AliExpress and email the customer the tracking number (see the Phase 5 SOP).

## Project layout

```
site.config.json     ← all business details, price, delivery estimate, pixel IDs
build.mjs            ← builds src/ into dist/ and generates functions/_lib/catalog.js
src/                 ← HTML pages, CSS, JS, images (+ src/media/hero.mp4 when you have one)
functions/api/       ← checkout, verify, paystack-webhook, subscribe
test/                ← node --test with Paystack and Brevo mocked
```

## Before you go live (the build refuses to deploy until this is done)

Fill in every `TODO` in `site.config.json`:

- [ ] `LEGAL_NAME`, `PHYSICAL_ADDRESS`, `CONTACT_EMAIL`, `CONTACT_PHONE`, `INFO_OFFICER`. The ECT Act (s43) requires these to be shown.
- [ ] `DELIVERY_ESTIMATE`, `SPEC_ROD`, `SPEC_WEIGHT`, `SPEC_IN_BOX`, taken from the supplier listing.
- [ ] Optional: `META_PIXEL_ID`, `TIKTOK_PIXEL_ID`. The cookie banner only appears once one of these is set.
- [ ] Optional: your own video at `src/media/hero.mp4` plus `src/media/hero-poster.jpg`. It replaces the illustration automatically.

## Deploy steps

You create every account yourself; all are free and none need a card.

1. **GitHub:** create a repo (e.g. `deep1ne8/curlcoco-store`) and push this folder:
   ```bash
   git remote add origin https://github.com/deep1ne8/curlcoco-store.git
   git push -u origin main
   ```
2. **Paystack:** sign up at paystack.com (as a sole proprietor, with your SA ID and bank account). Copy the **test** secret key first (`sk_test_…`). Under Settings → API Keys & Webhooks, set the webhook URL to `https://shop.deepevolution.za.net/api/paystack-webhook`.
3. **Brevo:** sign up, verify a sender email, and create 3 lists: *Newsletter*, *Checkout started*, *Customers*. Note their numeric IDs and create an API key (SMTP & API → API keys).
4. **Cloudflare:** Workers & Pages → Create → Pages → Connect to Git → pick the repo.
   - Build command: `npm ci && node build.mjs --strict`
   - Output directory: `dist`
   - Environment variables (Settings → Variables, set as *encrypted*):

     | Name | Value |
     |---|---|
     | `PAYSTACK_SECRET_KEY` | `sk_test_…` for testing, then `sk_live_…` |
     | `BREVO_API_KEY` | from Brevo |
     | `BREVO_SENDER_EMAIL` | your verified sender |
     | `OWNER_EMAIL` | where new-order alerts go |
     | `BREVO_LIST_NEWSLETTER` / `BREVO_LIST_CHECKOUT` / `BREVO_LIST_CUSTOMERS` | list IDs |

   - Settings → Bindings → add **KV namespace** named `ORDERS` (create one called `curlcoco-orders`).
   - Web Analytics → enable for the project (no code needed).
5. **Custom domain:** Pages project → Custom domains → add `shop.deepevolution.za.net`, then add the CNAME record it shows at your DNS host (Phase 4 covers this in detail).
6. **Test with Paystack's test cards**, then swap in the live key and redeploy.

## Email automations (set up in Brevo, free plan)

- **Welcome email:** an automation that triggers when a contact is added to *Newsletter*.
- **Abandoned cart:** shoppers who tick "Email me tips and offers" at checkout are added to *Checkout started*. When they pay, they're removed. Set an automation to wait 3 hours after a contact is added to *Checkout started*; if they're still on the list, send one reminder. Only people who opted in are ever emailed (POPIA s69).

## Local development

```bash
npm install
npm test          # function tests with Paystack and Brevo mocked
npm run dev       # build + wrangler pages dev on http://localhost:8788
```

For a real end-to-end payment locally, put `PAYSTACK_SECRET_KEY=sk_test_…` in a `.dev.vars` file (it's git-ignored).

## Security notes

- Card data never touches this site: payment happens on Paystack's hosted page.
- The webhook only acts on a valid signature and always re-checks the payment with Paystack.
- Strict CSP, HSTS and no framing are set in `src/_headers`. Pixels only load after the shopper accepts cookies.
- All customer text is HTML-escaped before it goes into an email.
