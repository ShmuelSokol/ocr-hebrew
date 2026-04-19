# Shopify-style roadmap — tiers 2, 3, 4

Tier 1 (landing / pricing / request-sample / credits / Stripe scaffolding) shipped 2026-04-19. This page tracks what's next, in rough priority order.

## Tier 2 — close the commerce loop

Stuff that turns paying customers into retained customers.

- [ ] **Hook credits to actual OCR usage**
  - Decrement `User.creditsBalance` by letter count on each successful OCR run
  - Block OCR when balance ≤ 0 and show a "top up" prompt
  - Free credits on signup already seeded (20,000 letters default)
- [ ] **Activate Stripe on prod**
  - Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on Railway
  - Create Stripe account (or use existing) and configure the webhook endpoint at `https://ksavyad.com/api/stripe/webhook`
  - Test checkout end-to-end in test mode before flipping to live
- [ ] **Phone top-up flow**
  - Admin tool to issue signed HMAC credit codes
  - User-facing "enter code" input on `/settings/billing` (already stubbed)
  - Codes embed: `userId | letters | issueDate | HMAC(secret, ...)` — verified offline-ready for the thumb-drive product
- [ ] **Invoice / billing history**
  - `/settings/billing/history` showing every `CreditTransaction` row
  - Downloadable PDF invoices for Stripe payments (Stripe hosted invoice URL works for v1)
- [ ] **Transactional emails** (Resend is the simplest)
  - New signup → welcome email
  - Sample request → admin notification + "we got it" autoresponder
  - Checkout success → receipt
  - Credits below 20% → warning
- [ ] **Thumb-drive order flow**
  - Schema: `PhysicalOrder { userId, tier, shippingAddress, trackingNumber, status }`
  - Shipping address capture on Archival purchase
  - Admin page to mark orders shipped + paste tracking number
- [ ] **Retraining cycle request**
  - Button on `/settings` → creates a `RetrainingRequest` row
  - One-click export of user's TrainingExamples zip
  - Admin dashboard shows queue

## Tier 3 — polish and trust

- [ ] **Email verification on signup** (NextAuth email provider or custom token flow)
- [ ] **Password reset flow** (currently non-existent; users are locked out if forgotten)
- [ ] **Privacy policy + Terms of Service pages** — `/privacy` and `/terms`
- [ ] **FAQ / help center** under `/help`
- [ ] **Status page** — either Statuspage.io or a minimal `/status` that reads `/api/health` + TrOCR `/health` + tunnel probe
- [ ] **Error tracking**: Sentry integration (5 min setup). Catches silent server failures.
- [ ] **Account deletion** — GDPR-lite: user can nuke their own data from `/settings`
- [ ] **Admin dashboard**
  - List all users with signup date, last active, credit balance, total spent
  - Sample requests inbox with status (new/responded/converted/rejected)
  - Impersonate user (for support debugging)

## Tier 4 — institutional sales

- [ ] **Multi-seat orgs** — schema: `Organization`, `OrganizationMember { userId, role }`
- [ ] **Role-based permissions** (owner / editor / viewer) on project data
- [ ] **Monthly usage reports** emailed on the 1st to each paying account
- [ ] **Custom SLAs** for Archival-tier institutional customers

## Ongoing

- [ ] **Analytics** — Plausible or self-hosted. Page views, conversion funnel.
- [ ] **SEO** — meta tags, sitemap, OG images on landing + pricing
- [ ] **Blog / case studies** under `/blog` once real customers exist
- [ ] **Testimonials carousel** on landing when we have 3+ happy users
- [ ] **A/B test framework** once conversion rate matters enough to optimize

## Explicit deferrals

- No mobile app
- No real-time OCR streaming
- No public API for third-party integrations
- No freemium tier — "free sample" funnel is the trial
