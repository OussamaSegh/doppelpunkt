# Doppelpunkt relay (optional)

Doppelpunkt calls AI providers **directly from the browser** with the learner's own key. Most of
the time that just works. Some providers, networks or browser setups block cross-origin calls
(CORS); then the app shows a "could not reach … (CORS)" error. This relay fixes that.

**You do not need it** unless you hit that error. It is a small, stateless Cloudflare Worker:

| Path            | Forwarded to                                   |
| --------------- | ---------------------------------------------- |
| `/anthropic/*`  | `https://api.anthropic.com/*`                  |
| `/openai/*`     | `https://api.openai.com/*`                     |
| `/gemini/*`     | `https://generativelanguage.googleapis.com/*`  |
| `/xai/*`        | `https://api.x.ai/*`                           |

## What it does and doesn't do

- Forwards only an allowlist of request headers (content type, the provider auth header,
  `anthropic-version`, …). Cookies, `Origin`, IP and Cloudflare headers are dropped.
- Streams the response body straight back (SSE streaming keeps working) and adds CORS headers.
- **Never logs, stores or inspects bodies or API keys.** No KV, no D1, no analytics. Worker
  observability is disabled in `wrangler.toml`.
- Your key still travels in the request — whoever runs the relay could in principle read it.
  Deploy your own; don't use a relay you don't trust.

## Deploy

```sh
cd services/relay
npx wrangler login
npx wrangler deploy
```

Wrangler prints a URL like `https://doppelpunkt-relay.<you>.workers.dev`. In the app open
**Settings → AI → Relay URL** and paste it. Requests then go to `<relay>/<provider>/<path>`.

### Restrict origins (recommended)

Set `ALLOWED_ORIGINS` to a comma-separated list, either in `wrangler.toml` under `[vars]` or with

```sh
npx wrangler deploy --var ALLOWED_ORIGINS:"https://your-doppelpunkt.example,http://localhost:5173"
```

Requests from other origins get `403`. Empty means any origin.

## Develop and test

```sh
npx wrangler dev            # local relay on http://localhost:8787
npx vitest run services/relay   # from the repo root
```
