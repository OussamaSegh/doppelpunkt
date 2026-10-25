# Doppelpunkt billing (optional)

A Cloudflare Worker with a D1 database that sells level unlocks through **Stripe Checkout** (plain
`fetch`, no SDK), verifies Stripe webhooks, redeems **book access codes** and lets learners
**restore** purchases. It answers with Ed25519-signed license tokens that the app verifies offline
(`packages/license`).

**You don't need it** to run Doppelpunkt: a build without `VITE_BILLING_URL` has every level unlocked.

- Routes: `src/http.ts` (`/v1/checkout`, `/v1/claim`, `/v1/webhook`, `/v1/redeem`, `/v1/restore`, `/v1/health`)
- Logic: `src/billing.ts`; Stripe REST + webhook signature: `src/stripe.ts`
- Schema: `migrations/0001_init.sql`; book codes: `npm run codes -w @doppelpunkt/billing`
- Tests: `test/` (`npx vitest run --project @doppelpunkt/billing`)

Setup, secrets and the owner's checklist: [`docs/PAYMENTS.md`](../../docs/PAYMENTS.md). What it
stores, for the privacy policy: [`docs/PRIVACY.md`](../../docs/PRIVACY.md#payments).
