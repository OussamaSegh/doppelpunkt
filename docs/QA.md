# QA — test strategy, how to run, device checklist

This is how we check Doppelpunkt before a release. The v0.1 exit criteria are in
[`ROADMAP.md`](ROADMAP.md): CI green (typecheck, unit tests, content lint, build, e2e), the app
installs on Android Chrome and iOS Safari, and a learner can finish A1 unit 1 offline without an API key.

## Test strategy

| Layer | Tool | Where | What it covers |
|---|---|---|---|
| Types | `tsc --noEmit` per workspace | every `package.json` has `typecheck` | the whole monorepo, including e2e specs and configs |
| Unit | Vitest (`vitest.config.ts` projects) | `packages/*/test`, `services/relay/test`, `tools/test`, `apps/web/src/**/*.test.tsx` | graders and German normalisation, FSRS, skill estimates, placement, AI adapters (mocked fetch), structured output, key vault, relay, linter and pack builder, exercise player (jsdom + fake IndexedDB) |
| Content | `npm run content:lint` | `content/` | schema, ids, variety tags, every exercise has a solution and an explanation, warnings for style |
| End to end | Playwright, Chromium | `apps/web/e2e/*.spec.ts` | the production build served by `vite preview` on port 4319, desktop Chrome and a Pixel 7 viewport |
| Manual | checklist below | real devices | install, offline, microphone, TTS, look and feel in both themes |

Principles:

- **AI is mocked, never called.** Unit tests stub `fetch`; e2e tests intercept
  `https://api.anthropic.com/**` with `page.route` and answer with a canned SSE stream. No test needs a key or network.
- **Tests read the real content.** E2e specs load `apps/web/dist/packs/a1.json` and pick exercises by type,
  so content edits (new items, re-ordering) don't break them. They only assume that unit 1 has at least
  one mcq, gap and order exercise and a Zurich German Swiss lane.
- **Accessible locators only** (`getByRole`, `getByLabel`). If a test can't find something by role and name,
  the UI is missing an accessible name — fix the UI, not the test.
- **No console errors.** An auto fixture (`e2e/fixtures.ts`) fails any test that logs `console.error` or
  throws an uncaught exception. A test can allow specific messages with `test.use({ allowConsole: [...] })`
  (only the offline test does, for failed network requests).

### E2e suite (14 tests × 2 projects = 28)

| Spec | Tests |
|---|---|
| `learn.spec.ts` | onboarding → Learn shows the A1 units; walk all steps of unit 1 and self-check; mcq wrong (solution + explanation) then right; gap wrong then right; word order wrong (closest accepted solution shown) then right; Swiss lane shows the dialogue and ZH tags |
| `review-progress.spec.ts` | empty deck → add unit 1 vocabulary → reveal and rate a card ("Good") → due count drops; progress screen shows the skill radar after one answer |
| `ai.spec.ts` | save an Anthropic key with a passphrase (stored encrypted), lock, wrong passphrase, unlock, forget; short passphrase rejected; tutor without a key shows "add a key"; tutor with a key streams a mocked reply and sends the key only to the provider |
| `pwa.spec.ts` | manifest (name, 192/512 PNG icons served, maskable icon, `display: standalone`, colours, apple-touch-icon); offline: after the first visit, go offline, reload → shell and A1 pack load, deep link to a unit works |

## How to run

```bash
npm ci                     # or npm install
npm run typecheck          # tsc in every workspace
npx vitest run             # all unit tests (same as npm test)
npm run content:lint       # content linter
npm run build              # content packs + production build of the web app
npm run test:e2e           # Playwright (Chromium, desktop + Pixel 7)
```

E2e details:

- The first time on a new machine: `npx playwright install --with-deps chromium`. If Chromium is installed
  somewhere else, point `PLAYWRIGHT_BROWSERS_PATH` at it.
- Locally the config builds first if `apps/web/dist` is missing (set `E2E_BUILD=1` to force a rebuild);
  otherwise it serves the existing build, so **run `npm run build` after changing app code**. In CI
  (`CI=true`) it never builds — the workflow's build step does.
- One spec or project: `npm run test:e2e -- e2e/ai.spec.ts --project=mobile`. Debug: `-- --ui` or `--headed`.
- Reports: `apps/web/playwright-report/index.html`; traces and screenshots of failures in `apps/web/test-results/`.
- Flakiness check before merging test changes: `npm run test:e2e -- --repeat-each=4`.

CI (`.github/workflows/ci.yml`) runs on every push and pull request to `main` with Node 22:
`npm ci` → typecheck → unit tests → content lint → build → install Chromium → e2e, and uploads the
Playwright report and test results when something fails.

## Manual device checklist

Run against a deployed preview over HTTPS (service workers and the microphone need a secure origin;
`localhost` also counts). Tick both themes where it says so.

### iOS Safari (iPhone, current iOS and one version back)

- [ ] Open the site in Safari, go through onboarding.
- [ ] Share → **Add to Home Screen**: the name is "Doppelpunkt" and the icon is the apple-touch-icon (not a screenshot).
- [ ] Launch from the home screen: opens standalone (no Safari toolbar), status bar and bottom nav respect the notch and home indicator (safe-area insets).
- [ ] Progress made in Safari is **not** shared with the home-screen app on iOS (separate storage) — expected; make sure onboarding appears and works there too.
- [ ] Airplane mode → relaunch the home-screen app: Learn shows the A1 units; open unit 1 and answer exercises.
- [ ] Listen buttons: Standard German uses a German voice; nothing crashes if no German voice is installed.
- [ ] Speak exercise: the microphone prompt appears on first use; deny → a clear message, the exercise can still be skipped; allow → recording works. (Speech recognition may be missing on iOS: check the fallback text.)
- [ ] Keyboard: umlaut bar inserts ä/ö/ü/ß at the cursor; inputs don't auto-capitalise or autocorrect.
- [ ] Light and dark theme follow the system setting; theme toggle works.

### Android Chrome (Pixel or similar, current Chrome)

- [ ] Open the site; Chrome offers **Install app** (menu → Install app, or the install banner).
- [ ] Installed app: correct name, icon (maskable, not cropped badly on round launchers), splash colour, opens standalone.
- [ ] Airplane mode → open the installed app: shell and A1 pack load; finish unit 1 (all steps, mark as done) offline without an API key.
- [ ] Back online: a new deployment updates the app on the next launch (autoUpdate service worker).
- [ ] Speak exercise: microphone permission prompt, deny and allow paths; speech recognition gives a transcript.
- [ ] Settings → save a real key with a passphrase, close the app, reopen: the key is **locked** until the passphrase is entered.
- [ ] Tutor with a real key streams a reply; the cost meter moves; spend cap 0 switches AI off.
- [ ] Light and dark theme.

### Desktop (Chrome, Firefox, Safari)

- [ ] Install from the address bar (Chrome/Edge). Firefox: works as a website (no install) — expected.
- [ ] Keyboard only: skip link, tab order, every button reachable, focus visible.
- [ ] Screen reader spot-check (VoiceOver or NVDA): German text is read with a German voice (`lang` attributes), variety tags are announced ("Zurich German").
- [ ] Export progress → Reset everything → Import progress restores it; keys are not in the export.

## Found issues and known gaps

### Fixed during QA (v0.1)

| Issue | Fix |
|---|---|
| Onboarding sometimes bounced the learner back to `/welcome` after "I'm new to German": each component had its own settings live query, so the onboarding gate could still see `onboarded: false` after onboarding had navigated to `/learn`. | `useSettings` now shares one app-wide Dexie live query through `useSyncExternalStore` (`apps/web/src/lib/hooks.ts`). |
| Offline after the first visit showed no lessons: the service worker never claimed the page on first install, and the packs were fetched before it was in control, so they were never runtime-cached. | `clientsClaim: true` in the Workbox config (`apps/web/vite.config.ts`) and the packs are re-fetched through the worker once it takes control (`warmPackCache` in `apps/web/src/content.ts`, called from `main.tsx`). |
| Every multiple-choice item in A1 has the correct answer first, and the player showed options in content order — the answer was always the top option. | `McqInput` shows options in a stable seeded shuffle (`apps/web/src/exercise/inputs.tsx`). |
| Missing accessible names: the word-order containers and the provider cards in Settings could not be found by role. | `role="group"` + names on "Your sentence" / "Words" and on each provider card (labelled by its heading). |

### Known gaps / open issues

- **Content:** no Bernese (`gsw-be`) exercises in units 1–3, although onboarding offers Bern; Bernese learners
  get the Zurich lane. (The 7 content-lint warnings about nouns without a plural seen early in QA have
  since been fixed; lint is now clean.) All mcq items still list the
  correct option first in the YAML (harmless now that the player shuffles, but authors should vary it).
  No recorded audio yet (TTS only; Swiss lane has none). Native-speaker review pending (`NATIVE_REVIEW.md`).
- **E2e not covered yet:** placement test, match / dictation / translate / transform / speak / write / role-play
  exercises in the browser (unit-tested in jsdom only), Bern dialect path, export/import, reset, theme switching,
  other AI providers in the browser, relay mode, spend-cap enforcement in the UI, the "Why?" button.
- **Not automatable here:** real install prompts, iOS Safari (WebKit is not in the CI matrix), microphone
  permission and speech recognition, TTS voices — see the manual checklist.
- The e2e Anthropic mock returns the whole SSE body at once; it checks that deltas are assembled, not timing.
- The tutor-with-key test blocks service workers so `page.route` sees the provider request; provider calls are
  not routed through the worker in the app either (cross-origin, no matching Workbox route).
- Locally the e2e config reuses an existing `dist/`; a stale build gives confusing failures — rebuild first.
