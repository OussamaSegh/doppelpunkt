# Payments and unlocks

A1 is free. A2 and above are unlocked per level, all at once with a yearly pass, or with the access
code in Book 1 (which unlocks A2). Unit 1 of every level is a free preview. The app keeps working
**offline and without an account**: an unlock is a signed **license token** stored on the device.

**Payments are off by default.** A build without `VITE_BILLING_URL` (and a public key) has every
level unlocked. This is the case for `npm run dev`, self-hosting and the GitHub Pages demo
(`.github/workflows/pages.yml` sets neither variable). Nothing in this document is needed to run
Doppelpunkt.

```
 app (PWA)                              services/billing (Cloudflare Worker + D1)          Stripe
 ─────────                              ─────────────────────────────────────────          ──────
 Unlock → Buy ──POST /v1/checkout──────▶ creates Checkout Session (REST, fetch) ─────────▶ hosted checkout
                                                                                            │ pays
 /unlock/done?session_id=cs_… ◀──────────────────────────── redirect (success_url) ◀────────┘
   └─POST /v1/claim───────────────────▶ purchase row → signed token ◀── POST /v1/webhook (signed)
 Enter book code ─POST /v1/redeem─────▶ HMAC(code) in D1, use count → signed token
 Restore ─POST /v1/restore {email, id}─▶ HMAC(email) matches → stored token
 token → Dexie `licenses` → verified on the device (WebCrypto Ed25519, public key in the build)
```

## The pieces

| Part | Where | What it does |
| --- | --- | --- |
| Contract | `packages/license` | products and display prices (`src/catalog.ts`), token format and Ed25519 sign/verify (`src/token.ts`), book codes with check character (`src/codes.ts`), entitlement rules (`src/entitlements.ts`), the public TEST keypair (`src/testing.ts`) |
| Worker | `services/billing` | Stripe Checkout + webhook, book code redemption, restore; D1 schema in `migrations/` |
| App | `apps/web/src/lib/billing`, `screens/Unlock.tsx`, `components/UnlocksSettings.tsx` | gate, token storage (Dexie v4 table `licenses`), lock badges in Learn, Unlock screen (lazy-loaded), Settings → Unlocks |

### Tokens

`DP1.<base64url(JSON)>.<base64url(Ed25519 signature)>` with the payload

```json
{ "v": 1, "kid": "k2026", "pid": "dp_7k3m9qxrt4wph2…", "sku": "pass-year", "lv": ["A2","B1","B2","C1","C2"], "iat": 1792950000, "exp": 1824486000 }
```

- No personal data: `pid` is a random purchase id (also on the Stripe receipt).
- `exp` only for the yearly pass (365 days from the purchase, no automatic renewal). Level unlocks
  and book codes don't expire. The device clock decides expiry (a learner who sets the clock back
  keeps a pass longer; accepted for an offline app).
- The app re-verifies every stored token on start. A token can't be revoked on a device that is
  offline; refunds mark the purchase on the server so it can't be claimed or restored again.
- `kid` allows key rotation: the build lists every public key it trusts.
- Tokens travel with **Export progress** and are merged (never removed) on import.
- Needs Ed25519 in WebCrypto: Chrome/Edge 137+, Firefox 129+, Safari 17+. Older browsers see a
  message asking them to update.

### Book codes

`B1K7M-3QXRT-4WPH9`: book tag `B1`, 12 random Crockford base32 characters (60 bits), one Luhn mod
32 check character. The app catches typos (every single wrong character and swapped neighbours)
before sending anything. The Worker stores only `HMAC-SHA-256(HASH_SECRET, "code:" + code)`, a use
counter and `max_uses` (1 = single use; 2 is a good default so a learner can unlock a second device).

### Endpoints

| Method | Path | Body | Answer |
| --- | --- | --- | --- |
| `POST` | `/v1/checkout` | `{ sku }` | `{ url, sessionId, pid }`; the app redirects to `url` |
| `POST` | `/v1/claim` | `{ sessionId }` | `{ token, pid, sku }`, `202 { pending }` while unpaid, `410` refunded |
| `POST` | `/v1/webhook` | Stripe event, `Stripe-Signature` | `{ received: true }` |
| `POST` | `/v1/redeem` | `{ code }` | `{ token, pid, sku }`; `400` typo, `404` unknown/revoked, `409` used up |
| `POST` | `/v1/restore` | `{ email, reference }` (`dp_…` or `cs_…`) | `{ token, pid, sku }`; one `404` for "unknown" and "wrong email" |
| `GET` | `/v1/health` | – | `{ ok, configured: { checkout, webhook, signing, hashing } }` |

- Webhook: `checkout.session.completed` and `checkout.session.async_payment_succeeded` fulfil paid
  sessions; `charge.refunded` (fully refunded) marks the purchase. The signature is checked as
  Stripe documents (HMAC-SHA-256 of `t.body`, 5-minute tolerance, any `v1` may match).
- Fulfilment is idempotent: the webhook, the claim after the redirect and a restore can race; one
  row per Checkout Session, and the same token every time (Ed25519 signatures are deterministic and
  `iat` is the session's creation time).
- Rate limit per client (HMAC of IP + day, memory only, never stored): `RATE_LIMIT_PER_HOUR`,
  default 30, on everything except the webhook.

## Setup

### 1. Keys for license tokens

```sh
npm run keygen -w @doppelpunkt/license -- --kid k2026
```

It prints the private key (for the Worker secret) and the line for the app build,
`VITE_LICENSE_PUBLIC_KEYS=k2026:<public key>`. Nothing is written to disk. Store the private key
in a password manager as well. **Never** use the TEST key from `packages/license/src/testing.ts`
outside tests: its private key is in git. The app build refuses it outside the e2e mode, and the
Worker refuses it unless `ALLOW_TEST_KEY=1`.

Rotation: generate a new pair with a new `--kid`, deploy the app with both public keys
(`k2026:…,k2027:…`), then switch the Worker to the new private key and `LICENSE_KEY_ID`. Keep old
public keys in the build as long as their tokens should work.

### 2. Stripe

1. In the Stripe dashboard (test mode first), create a **Product** with a one-time **Price** for each
   SKU you sell: `level-a2` … `level-c2` and `pass-year` (see `packages/license/src/catalog.ts`).
   Set the same amounts as `PRODUCTS` there (the app shows those; Stripe charges its own).
2. Settings → Payments → Checkout: enable the payment methods you want (cards, TWINT, …). Enable
   **email receipts** (Settings → Customer emails) so buyers get the purchase id.
3. Developers → API keys: create a **restricted key** with *Checkout Sessions: Write* (it also
   reads sessions), or use the secret key.
4. Developers → Webhooks: add the endpoint `https://<worker>/v1/webhook` with the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
   Copy its signing secret (`whsec_…`).
5. Tax: if you are VAT-registered, configure Stripe Tax or tax-inclusive prices; the Worker does
   not set tax options.

### 3. Deploy the Worker

```sh
cd services/billing
npx wrangler login
npx wrangler d1 create doppelpunkt-billing --location weur     # paste database_id into wrangler.toml
npx wrangler d1 migrations apply doppelpunkt-billing --remote
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put LICENSE_PRIVATE_KEY                     # from step 1
openssl rand -hex 32 | npx wrangler secret put HASH_SECRET      # keep it stable forever
# wrangler.toml [vars]: APP_URL, ALLOWED_ORIGINS, STRIPE_PRICES, LICENSE_KEY_ID
npx wrangler deploy
curl https://doppelpunkt-billing.<you>.workers.dev/v1/health    # every "configured" flag true
```

| Setting | Kind | Meaning |
| --- | --- | --- |
| `DB` | D1 binding | `migrations/0001_init.sql`: `purchases`, `book_codes` |
| `STRIPE_SECRET_KEY` | secret | Stripe key (restricted key recommended) |
| `STRIPE_WEBHOOK_SECRET` | secret | `whsec_…` of the webhook endpoint |
| `LICENSE_PRIVATE_KEY` | secret | Ed25519 PKCS#8, base64url |
| `HASH_SECRET` | secret | keys the email, code and rate-limit hashes. Changing it breaks every book code and email restore |
| `LICENSE_KEY_ID` | var | key id of the private key, e.g. `k2026` |
| `APP_URL` | var | the app's URL with a trailing slash; Stripe returns to `<APP_URL>unlock/done` |
| `ALLOWED_ORIGINS` | var | comma-separated app origins (empty = any) |
| `STRIPE_PRICES` | var | JSON `{"level-a2":"price_…","pass-year":"price_…"}`; SKUs without a price can't be bought |
| `RATE_LIMIT_PER_HOUR` | var | default 30 |
| `ALLOW_TEST_KEY` | var | `1` only for `wrangler dev` with the TEST key |

Keep `[observability] enabled = false`: request logs would contain IP addresses.

Local development: copy `.dev.vars.example` to `.dev.vars`, run `npx wrangler dev`, and forward
Stripe test webhooks with `stripe listen --forward-to localhost:8787/v1/webhook`. Run the app
against it with `VITE_BILLING_URL=http://localhost:8787 npx vite --mode e2e-billing` in `apps/web`
(that mode trusts the TEST public key and is the only one that accepts it).

### 4. Book codes

```sh
HASH_SECRET=<the Worker secret> npm run codes -w @doppelpunkt/billing -- \
  --book B1 --count 2000 --max-uses 2 --batch 2026-11-print-1
npx wrangler d1 execute doppelpunkt-billing --remote --file services/billing/codes-out/2026-11-print-1.sql
```

`codes-out/<batch>.codes.csv` has the plaintext codes for the printer (git-ignored; keep it offline
and private, anyone with a code can redeem it). Revoke a batch with
`UPDATE book_codes SET revoked = 1 WHERE batch = '…'`.

### 5. Build the app with payments

```sh
VITE_BILLING_URL=https://doppelpunkt-billing.<you>.workers.dev \
VITE_LICENSE_PUBLIC_KEYS=k2026:<public key> \
npm run build
```

Both must be set, or payments stay off (the build warns when only one is). The public key is not a
secret. Add both as CI/host variables for the production deployment only, not for the public demo.

## What the owner must do

- [ ] Generate the production keypair (step 1); store the private key safely.
- [ ] Create the Stripe products and prices; **set the real prices** in Stripe and in
      `packages/license/src/catalog.ts` (the amounts there are placeholders: CHF 14.90 per level,
      CHF 39.00 for the pass).
- [ ] Create the webhook and the API key; deploy the Worker with all secrets and vars; check `/v1/health`.
- [ ] Generate and import the Book 1 codes for each print run.
- [ ] Fill every `[PLACEHOLDER]` in `docs/PRIVACY.md`, `docs/legal/TERMS.md` and
      `docs/legal/IMPRINT.md` (operator name, address, contact, VAT status, hosting provider, law
      and jurisdiction), and have them reviewed by counsel. The app flags pages that still contain
      placeholders.
- [ ] Accept the Stripe and Cloudflare data processing agreements.
- [ ] Build the production app with `VITE_BILLING_URL` and `VITE_LICENSE_PUBLIC_KEYS`; buy each
      product once in Stripe test mode end to end (checkout, return, restore on a second browser,
      refund → claim refused), then switch to live keys.
- [ ] Yearly: delete purchase rows older than the 10-year retention period.

## Tests

- `packages/license/test`: tokens (sign/verify, tampering, wrong key, rotation, expiry, malformed),
  code check character (all single typos, swapped neighbours), entitlements, catalog.
- `services/billing/test`: webhook signature, checkout request to Stripe (mocked fetch), claim,
  redeem, restore, refunds, rate limit, origins, and the D1 SQL on the real migration (`node:sqlite`).
- `apps/web/src/lib/billing/billing.test.tsx`: gate, token storage, export/import, the Dexie v3→v4
  upgrade, Learn lock badges, the Unlock screen.
- `apps/web/e2e/billing` (`playwright.billing.config.ts`, build `npm run build:e2e-billing`):
  locked levels and the free preview, book code, Stripe checkout and return, restore, pasted tokens
  offline, against a mock Worker that signs with the TEST key.
