# FORGE failed-payment (dunning) setup

What this PR does
- `netlify/functions/fwn-stripe-webhook.js` (existing Stripe webhook function, reused) now also handles
  `invoice.payment_failed` (adds GHL tag `payment-failed`) and `invoice.paid` / `invoice.payment_succeeded`
  (removes it). Contacts are matched by the invoice's customer email in FORGE GHL; no contact is created.
  Only subscription invoices are handled. Logic: `netlify/functions/_Lib/dunning.js`.
- `/billing` (`billing.html`): stable update-card link used in the dunning emails/SMS. Signed-in members are sent
  to the Memberstack-managed Stripe customer portal (`launchStripeCustomerPortal`); others are asked to log in.

Env vars (Netlify, production) — no new ones
- `STRIPE_WEBHOOK_SECRET` — already required by this function. If the new endpoint below is a separate
  Stripe endpoint, use its signing secret here only if this function has no endpoint yet; otherwise add the
  invoice events to the existing endpoint so the secret stays the same.
- `GHL_API_KEY`, `GHL_LOCATION_ID` (`3dQD2B6ZsBjZVIrWF8WR`) — already set for memberstack-webhook.js.
  The key needs contacts read/write scope.

Stripe (John, FORGE account acct_1TZE0vK4zh6RSWCr) — Developers → Webhooks
- Endpoint URL: `https://forgedbyaris.com/.netlify/functions/fwn-stripe-webhook`
- Add events: `invoice.payment_failed`, `invoice.paid`, `invoice.payment_succeeded`
  (keep the existing checkout.session.* events). Do not touch Memberstack's own webhook.

Then publish the GHL workflow "FORGE Past-Due Dunning" (trigger: tag added `payment-failed`).
