# HoluVantage Daily Logic

A mobile-first daily colour-grid logic puzzle (two tiles; balance rows and columns; no three in a row; no duplicate lines) with themes, streaks, leaderboards, accounts, subscriptions, ads, an admin console and an endless portal mode.

- **Front end:** static HTML/CSS/ES modules in `public/` (no build step). PWA with offline shell.
- **API:** one Vercel serverless function (`api/router.js`) → `lib/`. All scores are verified server-side by replaying moves against the stored solution; the solution never reaches the browser.
- **Database/auth:** Supabase Postgres (RLS on, no client access) + Supabase Auth email magic links.
- **Payments:** Stripe (GBP/USD), Paystack (NGN), Razorpay (INR) via server-side keys and signed webhooks.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | Publishable/anon key (safe for browsers) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Secret** key from Supabase → Project Settings → API keys. Server only. |
| `PUZZLE_SECRET` | yes | Random 32+ chars. Seeds daily puzzles; never change after launch. |
| `GUEST_SECRET` | yes | Random 32+ chars. Signs guest tokens. Changing it logs out all guests. |
| `SITE_URL` | yes | e.g. `https://logic.holuvantage.com` |
| `ADMIN_EMAILS` | yes | Comma-separated admin emails |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for UK/US payments | Webhook URL: `/api/webhooks/stripe` (events: checkout.session.completed, customer.subscription.*, invoice.paid, invoice.payment_failed) |
| `STRIPE_PRICE_GBP_MONTHLY`, `STRIPE_PRICE_GBP_YEARLY`, `STRIPE_PRICE_USD_MONTHLY`, `STRIPE_PRICE_USD_YEARLY` | for UK/US payments | Recurring price IDs (£2.99/£24.99, $3.99/$29.99) with metadata-free products |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PLAN_NGN_MONTHLY` | for Nigeria | Plan ₦1,500/month. Webhook URL: `/api/webhooks/paystack` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_INR_MONTHLY` | for India | Plan ₹149/month. Webhook URL: `/api/webhooks/razorpay` (subscription.* events) |
| `ADS_PROVIDER`, `ADSENSE_CLIENT`, `ADSENSE_SLOT_HOME`, `ADSENSE_SLOT_RESULT` | optional | `ADS_PROVIDER=adsense` turns ads on. Rewarded hints use Google's H5 Games Ad Placement API (needs separate Google approval). Google requires a certified consent tool for UK/EEA traffic — enable Google's "Privacy & messaging" CMP in AdSense. |

A payment region whose keys are missing shows "Payments in this region open soon" instead of a broken button.

## Supabase setup
1. Apply `supabase/migrations/001_init.sql`.
2. Auth → URL Configuration: Site URL = `SITE_URL`; add `SITE_URL/` to Redirect URLs.
3. Auth → SMTP: connect a real email sender (e.g. Resend). Supabase's built-in email only reaches your own team and is heavily rate-limited.

## Tests
```
npm test                       # engine + server logic (19 tests)
node scripts/dev-server.mjs    # local harness (needs local Postgres + PostgREST; see script header)
node tests/e2e.mjs             # 62 end-to-end API checks
npm run pages                  # regenerate SEO/legal pages, sitemap, robots
```

## Operations
- Admin console: `/admin` (signed-in admin email only): metrics, retention, puzzle health, generate/validate/disable/replace puzzles, reports.
- Daily puzzles are created on first request each day; use "Generate upcoming days" to pre-build and check them.
- Streak grace: `STREAK_GRACE_DAYS` in `lib/core.js` (0 = off).
- Month-3 review trigger: below 5,000 daily players or Day-7 retention under 20%.
