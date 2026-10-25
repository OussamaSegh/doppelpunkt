# Doppelpunkt beta collector (optional)

A small Cloudflare Worker with a D1 database that receives the **opt-in** beta data from the app:
"this is wrong / unclear" reports, per-item counters and crash reports. The contract is
[`packages/beta-schema`](../../packages/beta-schema/src/index.ts); the privacy notice that the app
shows is [`docs/PRIVACY.md`](../../docs/PRIVACY.md).

**You don't need it** to run Doppelpunkt. Without a collector URL the app sends nothing.

## Endpoints

| Method | Path | Body / auth | Answer |
| --- | --- | --- | --- |
| `POST` | `/v1/ingest` | one `BetaEnvelope` or an array of up to 50, at most 64 KB | `200 { accepted, rejected }` |
| `POST` | `/v1/forget` | `{ "installId": "<32 hex>" }` | `200 { ok: true }`, also when there was nothing to delete |
| `GET` | `/v1/export` | `Authorization: Bearer <EXPORT_TOKEN>`, optional `?since=YYYY-MM-DD` | `200 ExportDump` |
| `GET` | `/v1/health` | – | `200 { ok, service, configured }` |

- Envelopes are validated with the zod schemas one by one. Invalid ones are counted in `rejected`
  and dropped; the valid ones in the same request are stored. Unknown fields are stripped.
- A stats batch is also rejected when it is implausible: more than 1000 attempts or 6 hours on one
  item, or more first-try buckets than attempts.
- The `day` of a stats batch counts when it is within one day of the server's date (UTC), otherwise
  the server's date is used.
- An empty stats batch (`items: []`) still counts as a day of activity for retention.
- Errors are `{ "error": { "message": "..." } }`: `400` bad JSON or install id, `401` export token,
  `403` origin, `404` unknown path or export disabled, `405` method, `413` body over 64 KB or more
  than 50 envelopes, `429` rate limit (with `Retry-After`), `503` not configured or storage down
  (the app should keep its outbox and retry later).
- `?since` filters feedback and crashes by the day they were received and stats by their day.
  Retention is always complete.

## What is stored

Schema: [`migrations/0001_init.sql`](migrations/0001_init.sql).

| Table | Contents | Deleted |
| --- | --- | --- |
| `feedback` | the report fields, comment and answer scrubbed again | after 1 year |
| `item_stats` | counters per item, content version, app version, band, day and cohort, summed on insert. **No install id.** | kept (anonymous aggregates) |
| `installs` | HMAC of the install id, first-seen day and ISO week, last upload day, bitmap of active weeks | 120 days after the last upload, or on `/v1/forget` |
| `crashes` | the report fields, scrubbed again (emails, URLs with a query string or fragment, runs of 7+ digits) | after 90 days |

- **Never stored:** IP addresses, raw install ids, request headers, request bodies as sent.
- **Rate limit:** the client key is HMAC(`RATE_SALT`, `CF-Connecting-IP` + UTC day), 24 hex chars.
  It lives in memory (per isolate) or, when `RATE_LIMIT_KV` is bound, in KV with a one-hour TTL.
  Default 120 requests per hour (`RATE_LIMIT_PER_HOUR`).
- **Cohort** of a stats row = ISO week the uploading install was first seen. Retention in the export:
  per cohort week, how many installs, and how many uploaded in weeks 1, 2, 3 and 4 after it.
- **Retention policy:** `scheduled()` runs daily (cron in `wrangler.toml`).
- Worker observability (request logs) is disabled in `wrangler.toml`.

## Deploy

```sh
cd services/collector
npx wrangler login
npx wrangler d1 create doppelpunkt-beta          # paste the database_id into wrangler.toml
npx wrangler d1 migrations apply doppelpunkt-beta --remote
npx wrangler secret put INSTALL_SECRET           # e.g. openssl rand -hex 32
npx wrangler secret put RATE_SALT
npx wrangler secret put EXPORT_TOKEN
npx wrangler deploy --var ALLOWED_ORIGINS:"https://doppelpunkt.example.org"
curl https://doppelpunkt-collector.<you>.workers.dev/v1/health
```

Pick a D1 location in the EU (`npx wrangler d1 create doppelpunkt-beta --location weur`) so that
the data stays in Europe (see `docs/PRIVACY.md`). Keep `INSTALL_SECRET` stable: a new one starts
every install as a new cohort.

Export for the item report in `tools/`:

```sh
curl -H "Authorization: Bearer $EXPORT_TOKEN" https://doppelpunkt-collector.<you>.workers.dev/v1/export > export.json
```

## Develop and test

```sh
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply doppelpunkt-beta --local
npx wrangler dev                       # http://localhost:8787
npx vitest run services/collector      # from the repo root
```

The logic (`src/collector.ts`) talks to a `Storage` interface (`src/storage.ts`). The tests use the
in-memory implementation; `test/storage-d1.test.ts` also runs the real migration and the D1 SQL on
SQLite through `node:sqlite` (skipped on Node versions without it).
