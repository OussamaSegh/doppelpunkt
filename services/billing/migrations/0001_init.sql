-- Doppelpunkt billing, initial schema (Cloudflare D1 / SQLite).
-- No names, no plaintext email addresses, no card data (Stripe keeps those), no IP addresses.

-- One row per fulfilled purchase or redeemed book code.
CREATE TABLE purchases (
  pid             TEXT    PRIMARY KEY,         -- random purchase id (dp_...), also in the token and on the receipt
  source          TEXT    NOT NULL,            -- 'checkout' | 'code'
  sku             TEXT    NOT NULL,            -- product (packages/license/src/catalog.ts)
  session_id      TEXT    UNIQUE,              -- Stripe Checkout session id (cs_...), checkout only
  payment_intent  TEXT,                        -- Stripe PaymentIntent id (pi_...), for refunds
  email_hash      TEXT,                        -- HMAC-SHA-256(HASH_SECRET, lower-case email), for "restore"; checkout only
  code_hash       TEXT,                        -- HMAC of the redeemed book code, code only
  token           TEXT    NOT NULL,            -- the signed license token that was issued
  status          TEXT    NOT NULL DEFAULT 'paid', -- 'paid' | 'refunded'
  created_at      INTEGER NOT NULL             -- ms since epoch
);
CREATE INDEX purchases_payment_intent ON purchases (payment_intent);
CREATE INDEX purchases_code_hash ON purchases (code_hash);

-- Book access codes, stored only as HMAC-SHA-256(HASH_SECRET, "code:" + normalised code).
-- Insert them with the SQL that `npm run codes -w @doppelpunkt/billing` writes.
CREATE TABLE book_codes (
  hash        TEXT    PRIMARY KEY,
  book        TEXT    NOT NULL,                -- book tag, e.g. 'B1'
  max_uses    INTEGER NOT NULL DEFAULT 1,      -- how many tokens one code may produce (devices / restores)
  uses        INTEGER NOT NULL DEFAULT 0,
  batch       TEXT    NOT NULL DEFAULT '',     -- print run, for bookkeeping and bulk revocation
  revoked     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX book_codes_batch ON book_codes (batch);
