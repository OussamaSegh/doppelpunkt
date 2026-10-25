# QA — test strategy, how to run, device checklist

This is how we check Doppelpunkt before a release. The v0.1 exit criteria are in
[`ROADMAP.md`](ROADMAP.md): CI green (typecheck, unit tests, content lint, build, e2e), the app
installs on Android Chrome and iOS Safari, and a learner can finish A1 unit 1 offline without an API key.
v0.2 adds the placement test, the exercise-player polish, the grammar reference, the Bern lane and the
audio pipeline; see [v0.2 "Erste Schritte"](#v02-erste-schritte) below.

## Test strategy

| Layer | Tool | Where | What it covers |
|---|---|---|---|
| Types | `tsc --noEmit` per workspace | every `package.json` has `typecheck` | the whole monorepo, including e2e specs and configs |
| Unit | Vitest (`vitest.config.ts` projects) | `packages/*/test`, `services/relay/test`, `tools/test`, `apps/web/src/**/*.test.tsx` | graders and German normalisation, FSRS, skill estimates, placement, AI adapters (mocked fetch), structured output, key vault, relay, linter and pack builder, exercise player (jsdom + fake IndexedDB) |
| Content | `npm run content:lint` | `content/` | schema, ids, variety tags, every exercise has a solution and an explanation, warnings for style; the lexicon (`content/lexicon/*.yaml`) against its schema |
| Generated files | `npm run audio:scripts -- --check` | `content/<level>/unit-NN/audio-*` | the audio manifests and recording scripts match the YAML (exits 1 when stale) |
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

### E2e suite (36 tests × 2 projects = 72)

v0.1 specs (14 tests):

| Spec | Tests |
|---|---|
| `learn.spec.ts` | onboarding → Learn shows the A1 units; walk all steps of unit 1 and self-check; mcq wrong (solution + explanation) then right; gap wrong then right; word order wrong (closest accepted solution shown) then right; Swiss lane shows the dialogue and ZH tags |
| `review-progress.spec.ts` | empty deck → add unit 1 vocabulary → reveal and rate a card ("Good") → due count drops; progress screen shows the skill radar after one answer |
| `ai.spec.ts` | save an Anthropic key with a passphrase (stored encrypted), lock, wrong passphrase, unlock, forget; short passphrase rejected; tutor without a key shows "add a key"; tutor with a key streams a mocked reply and sends the key only to the provider |
| `pwa.spec.ts` | manifest (name, 192/512 PNG icons served, maskable icon, `display: standalone`, colours, apple-touch-icon); offline: after the first visit, go offline, reload → shell and A1 pack load, deep link to a unit works |

v0.2 specs (22 tests) — see the v0.2 section for details: `placement.spec.ts` (4), `player.spec.ts` (10),
`grammar.spec.ts` (4), `bern.spec.ts` (4).

## How to run

```bash
npm ci                     # or npm install
npm run typecheck          # tsc in every workspace
npx vitest run             # all unit tests (same as npm test)
npm run content:lint       # content linter (units and lexicon)
npm run audio:scripts -- --check   # generated audio manifests/scripts are up to date
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

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request with Node 22:
`npm ci` → typecheck → unit tests → content lint (units + lexicon) → audio manifests up to date
(`npm run audio:scripts -- --check`) → build → install Chromium → e2e, and uploads the
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

## v0.2 "Erste Schritte"

### New automated coverage

E2e (real A1 pack, via `e2e/fixtures.ts`; `onboard(page, { dialect: 'Bern', start: 'placement' })`,
`openItem`, `answerCorrectly`, `shownExerciseId`, `pressOnPage`). Specs that need the app's own logic
to stay content-independent import it from `src/lib` (`wordsInExercises`, `searchGrammar`, `exercisesFor`).

| Spec | Tests |
|---|---|
| `placement.spec.ts` | intro (question count, sections, rules, Next disabled until answered, only de/ch-std closed items); wrong answers + "Stop here" → A1 unit 1, "ended early", no "Start from A1 unit 1 instead", "Start here" opens unit 1, result card on Progress; all right → mastered, placed at the last A1 unit, score table, "Start here" opens that unit, Progress card and the Learn "Start here" badge follow; keyboard-only run (Enter checks, Enter moves on) → "Start from A1 unit 1 instead" resets the start to unit 1 and keeps the result |
| `player.spec.ts` | umlaut bar inserts at the caret / replaces a selection and keeps focus, hides after Check; present under dictation, translate, transform and writing inputs; number keys 1–9 pick the option shown at that position, Enter checks, Enter goes to the next item; Enter in a gap submits; "Almost!" (`data-tone="almost"`) for a one-letter slip with the hint and solution, Try again clears and a right answer has no Try again; wrong → `data-tone="wrong"` with Try again; vibration patterns (`navigator.vibrate` stubbed) for wrong and right, none when the Settings toggle is off or with reduced motion; session summary after Finish (first-attempt score, right first time, by skill, mistakes, "Add missed words to review" → cards in Review, "Practise item n again" → `?item=<id>`), empty summary and "Practise this set again", Enter on the last item opens the summary |
| `grammar.spec.ts` | list of every point by unit (sidebar on desktop, Learn card on phones); search ignores accents and accepts ae/oe/ue, ss and case (`mochte`, `moechte`, `MÖCHTE`, `kuche`, `heisst`), counts match `searchGrammar`, empty state; detail view with "Practise this" links that open the item in its unit step, back links; unknown point → not-found state |
| `bern.spec.ts` | onboarding with Bern → the unit 1 Schwiiz lane lists every BE item before the ZH ones, BE tag on the first card, Bernese dialogue with a "Show the Zurich German version" toggle, no fallback note; every A1 unit leads with BE items (or shows the fallback note if a unit has none); Zurich learner gets ZH first and can show the Bernese dialogue, then switching to Bern in Settings puts BE first; "Not yet reviewed by a native speaker" note on unsigned units |

Unit tests added in v0.2 by the feature teams: `ExercisePolish.test.tsx`, `ExerciseRunner.test.tsx`,
`SwissLane.test.tsx`, `Placement.test.tsx` (including the adaptive stop between levels, which e2e can't
reach while only A1 is installed), `Grammar.test.tsx`, `tools/test/audio.test.ts`, `tools/test/report.test.ts`.
QA added `tools/test/lexicon.test.ts` (the real lexicon validates; schema errors, YAML errors and
duplicate headwords are reported; the lexicon is part of `content:lint`).

### Manual checks for v0.2

- [ ] **Vibration on Android** (Chrome, installed app and browser tab): a right answer gives one short
  buzz, "Almost!" a short double, a wrong answer a longer double. Settings → "Vibrate on right and wrong
  answers" off → no vibration. Android *Settings → Accessibility → Remove animations* on → no vibration.
  Placement test: never vibrates (no feedback during the test). iOS Safari has no Vibration API: nothing
  happens and nothing breaks.
- [ ] **Umlaut bar on phone keyboards** (Gboard and Samsung keyboard on Android, iOS keyboard): tapping
  ä/ö/ü/ß inserts at the caret without closing the keyboard or jumping the page; works in gaps (with
  several gaps, into the one last focused), dictation, translation, transform, writing tasks and the tutor
  chat; autocorrect and auto-capitalisation stay off in answer fields; VoiceOver/TalkBack read "Insert ä"
  and "Insert capital Ä" differently.
- [ ] **Almost panel in both themes**: light and dark (system setting and the theme toggle), the
  "≈ Almost!" panel uses the accent colour and is clearly different from the green "Richtig!" and red
  "Not quite" panels; text contrast is readable; the hint ("… should be …") and the solution are visible.
- [ ] Keyboard on desktop: 1–9 pick options (kbd badges visible from `sm` up), Enter checks and moves on,
  Enter in a textarea makes a new line and Ctrl/Cmd+Enter checks; Tab order still reaches every button.
- [ ] Placement test on a phone: about 25 minutes for 30 questions is realistic; "Stop here" at any point
  gives a sensible result; the result text reads well.
- [ ] Bern learner: onboarding with Bern, then every unit's Schwiiz lane starts with BE items; Settings →
  change dialect to Zurich and back reorders the lane.
- [ ] Grammar reference on a phone: reached from the Learn card; search works with the phone keyboard
  (no umlaut needed: "mochte" finds möchte).

## Found issues and known gaps

### Fixed during QA (v0.2)

| Issue | Fix |
|---|---|
| `npm run audio:scripts -- --check` never checked anything: the root script forwarded `--check` to the inner `npm run` as an npm option instead of to the tool, so it regenerated the files and always exited 0. | The root `audio:scripts` script ends with `--` like `audio:process` and `audio:link` (`package.json`). |
| `content/lexicon/gsw-zh.yaml` had `kaufen` twice (the second copy without the Bernese form). | Removed the duplicate; `content:lint` now reports duplicate headwords. |
| The lexicon was never validated: a typo in a field name or a broken YAML line went unnoticed. | Light zod schema in `tools/src/lexicon.ts`, run by `content:lint`, tested in `tools/test/lexicon.test.ts`. |
| The umlaut bar's buttons "Insert ä" and "Insert Ä" had names that differ only in case (screen readers say the same thing). | Capitals are labelled "Insert capital Ä" (`apps/web/src/exercise/UmlautBar.tsx`). |
| `tools` imported `zod` without declaring it. | Declared in `tools/package.json` (already installed via content-schema; lockfile entry updated, no new download). |



### Fixed during QA (v0.1)

| Issue | Fix |
|---|---|
| Onboarding sometimes bounced the learner back to `/welcome` after "I'm new to German": each component had its own settings live query, so the onboarding gate could still see `onboarded: false` after onboarding had navigated to `/learn`. | `useSettings` now shares one app-wide Dexie live query through `useSyncExternalStore` (`apps/web/src/lib/hooks.ts`). |
| Offline after the first visit showed no lessons: the service worker never claimed the page on first install, and the packs were fetched before it was in control, so they were never runtime-cached. | `clientsClaim: true` in the Workbox config (`apps/web/vite.config.ts`) and the packs are re-fetched through the worker once it takes control (`warmPackCache` in `apps/web/src/content.ts`, called from `main.tsx`). |
| Every multiple-choice item in A1 has the correct answer first, and the player showed options in content order — the answer was always the top option. | `McqInput` shows options in a stable seeded shuffle (`apps/web/src/exercise/inputs.tsx`). |
| Missing accessible names: the word-order containers and the provider cards in Settings could not be found by role. | `role="group"` + names on "Your sentence" / "Words" and on each provider card (labelled by its heading). |

### Known gaps / open issues

- **Content:** every A1 unit (1–6) now has Bernese items, so the Bern fallback note can't be seen with real
  content (unit-tested in `SwissLane.test.tsx`). No recorded audio yet (audio coverage 0/968; TTS only, Swiss
  lane has none). Native-speaker review pending for all six units (`NATIVE_REVIEW.md`; the lint prints the
  review sign-off summary).
- **Placement:** only A1 is installed, so the e2e run has one section and the adaptive stop between levels
  is covered by unit tests only. The roadmap exit criterion (80% within one unit of a teacher's assessment)
  needs a study with real learners; nothing here measures it.
- **E2e not covered yet:** match / dictation / translate / transform answers graded in the browser
  (inputs checked, grading unit-tested in jsdom), speak / write / role-play flows, export/import, reset, theme
  switching, other AI providers in the browser, relay mode, spend-cap enforcement in the UI, the "Why?" button,
  Ctrl/Cmd+Enter in textareas, the audio tools against real recordings (unit-tested with ffmpeg when present).
- **Not automatable here:** real install prompts, iOS Safari (WebKit is not in the CI matrix), microphone
  permission and speech recognition, TTS voices — see the manual checklist.
- The e2e Anthropic mock returns the whole SSE body at once; it checks that deltas are assembled, not timing.
- The tutor-with-key test blocks service workers so `page.route` sees the provider request; provider calls are
  not routed through the worker in the app either (cross-origin, no matching Workbox route).
- Locally the e2e config reuses an existing `dist/`; a stale build gives confusing failures — rebuild first.
