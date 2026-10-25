# Deploying Doppelpunkt

Doppelpunkt is a static PWA. The production build is a folder of HTML, JS, CSS and JSON
(`apps/web/dist/`), and any static host can serve it. There is no backend. Learners' progress
stays in their browser (IndexedDB), and their AI keys go only to the provider they choose, or to
the optional relay. Two parts are optional:

| Part | Needed when | Where |
| --- | --- | --- |
| Audio CDN (R2 / S3) | The recordings make the site too heavy for the static host, or you want audio cached at the edge | `npm run audio:upload`, `AUDIO_*` env vars |
| AI relay (Cloudflare Worker) | A provider or network blocks direct browser calls (CORS) | `services/relay/` |

## 1. Build

```sh
npm ci
npm run build          # content:build (lint + packs + audio) and vite build
```

- Output: `apps/web/dist/`. The content packs are in `dist/packs/` (`index.json`, `a1.json`, ...,
  `pronunciation.json`). Audio is in `dist/packs/audio/`, unless the packs point to a CDN (section 3).
- `content:build` refuses to build when `content:lint` finds errors.
- Builds are deterministic. Set `SOURCE_DATE_EPOCH` to fix `builtAt` in the packs. Without it,
  `builtAt` is the time of the newest content file.
- Node 20+ (CI uses 22). Without `AUDIO_PUBLIC_BASE` the build needs no environment variables.

### Sub-path hosting

The app uses Vite's `BASE_URL` for routing and the packs (`<base>packs/`). To serve it from a sub-path
such as `https://example.org/doppelpunkt/`, build with `npx vite build --base /doppelpunkt/`
(run in `apps/web` after `npm run content:build`). A host's own domain or subdomain needs nothing.

## 2. Hosting the PWA

Every host needs three things:

1. **SPA fallback.** Unknown paths serve `index.html` (the app uses client-side routes such as `/unit/a1-u01`).
   Where the host allows it, exclude `/packs/*` so that a missing pack returns 404 (the app then shows
   "no content"). If it gets `index.html` instead, it reports a load error. Either way the build always
   writes `packs/index.json`, so this only matters for half-finished deploys.
2. **HTTPS.** Service workers and the microphone (speaking practice) only work on a secure origin.
3. **Cache headers.** `sw.js`, `index.html`, `manifest.webmanifest` and `packs/*.json` must be
   revalidated on every request (`no-cache`), so updates reach learners on their next visit. Files under
   `assets/` have hashed names and can be cached forever.

### Cloudflare Pages

- Dashboard: *Workers & Pages → Create → Pages → Connect to Git*.
  - Build command: `npm run build`
  - Build output directory: `apps/web/dist`
  - Environment variables: `NODE_VERSION=22`, plus `AUDIO_PUBLIC_BASE` if you use the audio CDN.
- Or from the command line: `npm run build && npx wrangler pages deploy apps/web/dist --project-name doppelpunkt`.
- SPA fallback: a Pages project without a `404.html` serves `index.html` for unknown paths, which is
  what the app needs. Set the cache headers with an `apps/web/public/_headers` file (it is copied into
  `dist/`):

  ```
  /sw.js
    Cache-Control: no-cache
  /index.html
    Cache-Control: no-cache
  /packs/*
    Cache-Control: no-cache
  /packs/audio/*
    Cache-Control: public, max-age=86400
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

- Pages limits: 20,000 files and 25 MiB per file. All A1 audio (mp3 + opus) fits. For all levels,
  use the audio CDN.

### Vercel

- *Add New → Project*, import the repository, framework preset **Other**:
  - Build command: `npm run build`
  - Output directory: `apps/web/dist`
  - Install command: `npm ci`
- Add a `vercel.json` at the repository root for the SPA fallback and the headers:

  ```json
  {
    "rewrites": [{ "source": "/((?!packs/|assets/|icons/|sw\\.js|workbox-).*)", "destination": "/index.html" }],
    "headers": [
      { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/packs/(.*)\\.json", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
    ]
  }
  ```

- Environment variables (Project → Settings → Environment Variables): `AUDIO_PUBLIC_BASE` if you use the
  audio CDN. Never add AI keys: the app has none. Learners enter their own keys in Settings.

### Other static hosts

Netlify, GitHub Pages, S3 + CloudFront and nginx work the same way: serve `apps/web/dist/`, add the
SPA fallback (with a 404 for `/packs/*`), and set the cache headers above. On GitHub Pages, build
with `--base /<repo>/`.

## 3. Audio on a CDN (Cloudflare R2 or Amazon S3)

By default `content:build` copies every referenced recording into `packs/audio/`, so the audio
ships with the site. For a CDN:

1. `npm run audio:upload` uploads the processed audio (mp3 + opus) to a bucket.
2. `content:build` with `AUDIO_PUBLIC_BASE` set writes the CDN URLs into the packs and copies no audio.

```
content/**/audio/*.mp3|.opus ──audio:upload──▶ bucket: a1/a1-u01/audio/dialog-intro-01.3f9c0e1a2b4d.mp3
                                                          (+ .opus with the same hash)
unit YAML  audio: audio/dialog-intro-01.mp3
           ──content:build (AUDIO_PUBLIC_BASE)──▶ pack: "audio": "https://audio.example.org/a1/a1-u01/audio/dialog-intro-01.3f9c0e1a2b4d.mp3"
```

### Environment variables

| Variable | Used by | Example |
| --- | --- | --- |
| `AUDIO_BUCKET` | upload | `doppelpunkt-audio` |
| `AUDIO_ENDPOINT` | upload | R2: `https://<account id>.r2.cloudflarestorage.com`; S3: `https://s3.eu-central-1.amazonaws.com` (path-style) or `https://{bucket}.s3.eu-central-1.amazonaws.com` (virtual-hosted; `{bucket}` is replaced) |
| `AUDIO_ACCESS_KEY_ID` | upload | R2: an API token's access key ID (*R2 → Manage API tokens*, "Object Read & Write" on this bucket only) |
| `AUDIO_SECRET_ACCESS_KEY` | upload | the token's secret |
| `AUDIO_PUBLIC_BASE` | upload, build | the public URL of the bucket root: R2 custom domain `https://audio.example.org` or `https://pub-<id>.r2.dev`; S3/CloudFront URL |
| `AUDIO_REGION` | upload (optional) | `auto` (default, R2) or the S3 region, e.g. `eu-central-1` |

Keep the access key and secret out of git and out of the web build. Only the uploading machine or CI
job needs them. The static host needs `AUDIO_PUBLIC_BASE` only.

### `npm run audio:upload`

```sh
npm run audio:upload                 # dry run unless all five AUDIO_* variables are set
npm run audio:upload -- --dry-run    # list what would be uploaded, never touches the network
npm run audio:upload -- --concurrency 8
```

- Uploads exactly the files the packs reference: unit, mock exam and pronunciation audio, each with its
  `.opus` sibling when one exists. Processed files that no YAML field references yet are not uploaded.
  Run `npm run audio:link` first.
- **Keys** mirror `packs/audio/`, with a content hash in the file name:
  `<level>/<unit id>/audio/<name>.<hash>.mp3`, `<level>/<exam id>/audio/...`,
  `pronunciation/<drill id>/audio/...`. The `.mp3` and `.opus` of a recording share one 12-hex-digit hash,
  computed from both files, so the app can swap the extension to find the Opus version.
- **Skip unchanged.** Each object carries `x-amz-meta-sha256` (the sha256 of the file). Before a PUT,
  the tool sends a HEAD request, and objects whose stored hash matches are skipped, so re-runs are cheap.
  A new take gets a new hash and so a new key. Old objects stay, so pages that are already open keep
  working. Clean them up with a bucket lifecycle rule if you need to.
- **Headers:** `Content-Type` (`audio/mpeg`, `audio/ogg; codecs=opus`) and
  `Cache-Control: public, max-age=31536000, immutable`. This is safe because a name never changes content.
- Requests are signed with AWS Signature Version 4 (`tools/src/sigv4.ts`, Node built-ins only; tested
  against the AWS documentation's example signatures). The tool sends no other requests and stores no
  credentials.
- Exit code 1 when any upload fails. Re-run it: finished files are skipped.

### Build against the CDN

```sh
AUDIO_PUBLIC_BASE=https://audio.example.org npm run build
```

`content:build` computes the same hashed keys from the local files and writes
`AUDIO_PUBLIC_BASE/<key>` into every audio field of the packs (units, exams, drills). It copies nothing into
`packs/audio/`. Fields whose file does not exist locally stay relative, so the app falls back to
text-to-speech as usual. **Upload before you deploy:** run `audio:upload` and the build from the same
checkout, or the URLs point to objects that are not there yet.

### Bucket setup

- **Cloudflare R2:** create the bucket, then *Settings → Public access*: connect a custom domain
  (recommended, cached at the edge) or enable the `r2.dev` URL (rate-limited, fine for testing).
- **Amazon S3:** serve the bucket through CloudFront, or allow public `s3:GetObject` on the bucket.
- **CORS:** the app plays audio with `<audio>` elements and the service worker caches it (`dp-audio`,
  with range requests). Allow `GET` and `HEAD` from your app's origin, with the `Range` header:

  ```json
  [{ "AllowedOrigins": ["https://doppelpunkt.example.org", "http://localhost:5173"],
     "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["Range"], "MaxAgeSeconds": 86400 }]
  ```

### CI example (GitHub Actions)

```yaml
- run: npm ci
- run: npm run content:lint
- run: npm run audio:upload
  env:
    AUDIO_BUCKET: ${{ vars.AUDIO_BUCKET }}
    AUDIO_ENDPOINT: ${{ vars.AUDIO_ENDPOINT }}
    AUDIO_PUBLIC_BASE: ${{ vars.AUDIO_PUBLIC_BASE }}
    AUDIO_ACCESS_KEY_ID: ${{ secrets.AUDIO_ACCESS_KEY_ID }}
    AUDIO_SECRET_ACCESS_KEY: ${{ secrets.AUDIO_SECRET_ACCESS_KEY }}
- run: npm run build
  env:
    AUDIO_PUBLIC_BASE: ${{ vars.AUDIO_PUBLIC_BASE }}
- run: npx wrangler pages deploy apps/web/dist --project-name doppelpunkt
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

## 4. The optional AI relay

The app calls AI providers directly from the browser with the learner's own key. If a provider or
network blocks that (the app reports a CORS error), deploy the relay. It is a stateless Cloudflare
Worker that forwards `/<provider>/*` to the provider's API, streams the answer back and adds CORS
headers. It has no storage and no logs.

```sh
cd services/relay
npx wrangler login
npx wrangler deploy --var ALLOWED_ORIGINS:"https://doppelpunkt.example.org"
```

Learners then paste the Worker URL under **Settings → AI → Relay URL**. The key still travels in each
request, through the relay, so only use a relay you run yourself or trust. Details, including
the header allowlist, are in `services/relay/README.md`.

## 5. Checklist before a release

- [ ] `npm run typecheck && npx vitest run && npm run content:lint && npm run audio:scripts -- --check`
- [ ] With a CDN: `npm run audio:upload` finished with 0 failed, then the build used the same `AUDIO_PUBLIC_BASE`
- [ ] Deployed preview over HTTPS: the app installs, works offline after the first visit, and plays audio
  (check one CDN URL in the browser's network panel when you use the CDN)
- [ ] `docs/QA.md` run on the preview
