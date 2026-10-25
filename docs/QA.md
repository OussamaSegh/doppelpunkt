# QA — test strategy, how to run, device checklist

This is how we check Doppelpunkt before a release. The v0.1 exit criteria are in
[`ROADMAP.md`](ROADMAP.md): CI green (typecheck, unit tests, content lint, build, e2e), the app
installs on Android Chrome and iOS Safari, and a learner can finish A1 unit 1 offline without an API key.
v0.2 adds the placement test, the exercise-player polish, the grammar reference, the Bern lane and the
audio pipeline; see [v0.2 "Erste Schritte"](#v02-erste-schritte) below. v0.3 adds recording, speech
recognition with a provider fallback, shadowing, pronunciation drills and A1 units 7–9; see
[v0.3 "Stimme"](#v03-stimme) for the new coverage and the speaking device checklist. v0.4 adds A1 units
10–12, the timed mock exams, the can-do checklist and "A1 complete" milestone, the accessibility audit and
the performance budget; see [v0.4 "A1 komplett"](#v04-a1-komplett).

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
  `https://api.anthropic.com/**` (canned SSE stream) and `https://api.openai.com/v1/audio/transcriptions`
  (canned JSON) with `page.route`. No test needs a key or network.
- **Media is faked, never real.** Speaking specs use Chromium's fake microphone
  (`--use-fake-device-for-media-stream`, permission granted) so MediaRecorder records a real beep, and
  `e2e/media.ts` replaces browser speech recognition (removed, or a fake that "hears" a given text) and
  `speechSynthesis.speak` (counted in `window.__ttsCalls`, ended at once).
- **Tests read the real content.** E2e specs load `apps/web/dist/packs/a1.json` and pick exercises by type,
  so content edits (new items, re-ordering) don't break them. They only assume that unit 1 has at least
  one mcq, gap and order exercise and a Zurich German Swiss lane.
- **Accessible locators only** (`getByRole`, `getByLabel`). If a test can't find something by role and name,
  the UI is missing an accessible name — fix the UI, not the test.
- **No console errors.** An auto fixture (`e2e/fixtures.ts`) fails any test that logs `console.error` or
  throws an uncaught exception. A test can allow specific messages with `test.use({ allowConsole: [...] })`
  (only the offline test does, for failed network requests).

### E2e suite (61 tests × 2 projects = 122)

v0.1 specs (14 tests):

| Spec | Tests |
|---|---|
| `learn.spec.ts` | onboarding → Learn shows the A1 units; walk all steps of unit 1 and self-check; mcq wrong (solution + explanation) then right; gap wrong then right; word order wrong (closest accepted solution shown) then right; Swiss lane shows the dialogue and ZH tags |
| `review-progress.spec.ts` | empty deck → add unit 1 vocabulary → reveal and rate a card ("Good") → due count drops; progress screen shows the skill radar after one answer |
| `ai.spec.ts` | save an Anthropic key with a passphrase (stored encrypted), lock, wrong passphrase, unlock, forget; short passphrase rejected; tutor without a key shows "add a key"; tutor with a key streams a mocked reply and sends the key only to the provider |
| `pwa.spec.ts` | manifest (name, 192/512 PNG icons served, maskable icon, `display: standalone`, colours, apple-touch-icon); offline: after the first visit, go offline, reload → shell and A1 pack load, deep link to a unit works |

v0.2 specs (22 tests) — see the v0.2 section for details: `placement.spec.ts` (4), `player.spec.ts` (10),
`grammar.spec.ts` (4), `bern.spec.ts` (4).

v0.3 specs (17 tests) — see the v0.3 section: `pronunciation.spec.ts` (6), `speaking.spec.ts` (10), one more
test in `learn.spec.ts` (units 7–9).

v0.4 specs (8 tests, plus a longer offline test) — see the v0.4 section: `exam.spec.ts` (3), `cando.spec.ts` (2),
`listening.spec.ts` (2), one more test in `learn.spec.ts` (units 10–12); `pwa.spec.ts` offline test extended.

## How to run

```bash
npm ci                     # or npm install
npm run typecheck          # tsc in every workspace
npx vitest run             # all unit tests (same as npm test)
npm run content:lint       # content linter (units and lexicon)
npm run audio:scripts -- --check   # generated audio manifests/scripts are up to date
npm run build              # content packs + production build of the web app
npm run budget -w @doppelpunkt/web   # initial JS < 200 KB gzip (after build)
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
(`npm run audio:scripts -- --check`) → build → performance budget → install Chromium → e2e, and uploads the
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

## v0.3 "Stimme"

Exit criterion (ROADMAP): speaking exercises usable on iOS Safari, Android Chrome and desktop; recognition
fallback tested. The automated part runs in Chromium only (desktop + Pixel 7); everything that needs a real
microphone, a real recogniser or a real voice is in the device checklist below.

### New automated coverage

Helpers: `e2e/media.ts` — `stubMedia(page, { recognition, getUserMediaError, micPermission })`,
`ttsCalls(page)`, `storedAttempts(page)` (attempt rows from IndexedDB) and `fakeMic` (launch args and the
microphone permission). `speaking.spec.ts` sets the fake-device launch args for the whole file (Playwright
can't change launch options per describe block). Specs pick content through the app's own code
(`discriminationQuiz`, `grade`, `resultTone`, `micFixSteps`) so content edits don't break them.

| Spec | Tests |
|---|---|
| `pronunciation.spec.ts` | list of all 16 drills (titles, pair/word counts), reached from the desktop "Reference" sidebar or the Learn card on phones, opens a drill and back; drill view (explanation, tips, minimal pairs, quiz section, repeat-after-me stepper with Previous/Next, "Practise" on a word jumps the stepper, speeds 0.75×/1×/1.25×); "Which did you hear?" plays the word (TTS stub), right then wrong answer ("Not quite: it was …"), both stored as **listening** attempts (score 1 and 0) under `pron-<id>`, the list counts speaking tries only; repeat after me: self-rating "Good" → "Self-rated", "Try again", stored as **speaking**, the list shows "1 try, 100% avg", Progress radar + Speaking row; Swiss drill without recordings: "No recording yet" on every pair side, the quiz and the native column, no listen/"Listen, then speak" buttons, self-rating works, **zero** `speechSynthesis.speak` calls; unknown drill → "Drill not found" |
| `speaking.spec.ts` | fake mic, no recognition, no key: Record → timer → Stop → "Record again", "Your recording" `<audio>` with a decodable `blob:` source, "Play native (synthetic voice)" speaks the target in de-DE at 1×, only self-rating offered, "Sounded right" stores a speaking attempt and the Progress radar/table shows Speaking; fake browser recognition (de-DE): transcript filled, "Recognised by your browser (de-DE)", the learner corrects it ("corrected by you"), Check → tone from the engine, word-by-word diff with "(missing)", "Sounds to work on" with the ü hint, attempt score = engine score; ch-std item recognises in **de-CH**; shadowing mode on a speak item: speed 0.75× → "Listen, then speak" plays the TTS at 0.75 and starts recording; **recognition fallback**: no browser recognition + saved OpenAI key → "Transcribe with OpenAI" → mocked `/v1/audio/transcriptions` (one request, `Bearer` key, multipart with `audio.webm` and `gpt-4o-transcribe`) → "Transcribed by OpenAI" → Richtig!; getUserMedia `NotAllowedError` → "Microphone access is blocked", the platform's fix steps (`micFixSteps` for the UA: desktop or Android), Record still enabled, self-rating still works; Permissions API "denied" shows the steps before recording; "prompt" shows the first-use note; dialogue shadowing on Einstieg (Line n of N, speeds, loop toggle, native at 1.25×, Close); Swiss lane: Zurich German lines without audio have no listen button, shadowing shows "No recording yet", zero TTS calls |
| `learn.spec.ts` (+1) | units 7, 8 and 9 are listed on Learn with their titles; unit 9 opens on Einstieg |

Unit tests from the feature teams (jsdom with `src/test/media.ts` doubles): `Recorder.test.tsx` (max length,
re-record, permission states, level meter, ShadowPanel), `SpeakTask.test.tsx` (browser → provider → self
path), `Pronunciation.test.tsx`; engine `gradeSpeech` / `minimalPairQuiz`; provider `transcribe` in
`packages/ai/test/providers.test.ts`; `tools/test/pronunciation.test.ts` (drill lint, pack, audio manifest).

Not automated: Gemini transcription in the browser (unit-tested only), real Chromium/Safari recognition,
WebKit (iOS) and Firefox, real TTS voices and rates, mp4 recordings (Chromium records webm).

### Manual device checklist: speaking

Over HTTPS (or `localhost`). For every platform use one unit speak item (Übungen), one Standard German
drill (e.g. *ü vs u and i*) and one Swiss drill (*Swiss German ch, gg and kch*). Tick both themes once.

**Permission prompt, deny, fix** (every platform)

- [ ] First Record: the browser asks for the microphone; the "Your browser will ask…" note was shown before.
- [ ] Deny → red "Microphone access is blocked for this site." with this platform's steps; the steps are
  correct for the browser in front of you; self-rating still works; nothing else breaks.
- [ ] Follow the steps, reload → Record works without a new prompt (or with one, then allowed).
- [ ] No microphone / microphone in use by a call → the "No microphone was found" / "in use" text.

**Recording and playback**

- [ ] Waveform moves while speaking, flat when silent; the timer counts to the max and recording stops by itself.
- [ ] "Your recording" plays back, at normal pitch and with sound (not silent, not chipmunk); "Record again" replaces it.
- [ ] iOS Safari / macOS Safari record **audio/mp4** (m4a) and play it back; Chrome, Edge, Firefox, Android
  record **webm/opus** and play it back. (In Safari devtools: the `<audio>` source is a `blob:` of type audio/mp4.)
- [ ] Native playback: "Play native (synthetic voice)" for Standard German; Swiss German without recordings
  says "No recording yet" and **never** speaks with a German voice (also in the Swiss lane dialogue).

**Recognition**

- [ ] Chrome desktop, Edge, Android Chrome: browser recognition fills "What we heard" while speaking;
  Standard German items show **de-DE**, Swiss Standard German (`ch-std`) items **de-CH**; the status line says
  "Recognised by your browser (…)". Correcting the text adds "corrected by you".
- [ ] Swiss German (gsw) drill: the note explains recognition only knows Standard German.
- [ ] Safari (iOS 14.5+ / macOS): `webkitSpeechRecognition` works or is absent — either way there is a path:
  transcript, provider transcription or self-rating. On iOS the installed PWA may lack recognition — check the fallback text.
- [ ] Firefox: no recognition → "Your browser can't recognise speech…" and self-rating.
- [ ] **Provider fallback** with a real OpenAI key and with a real Gemini key: "Transcribe with …" → text
  comes back, "Transcribed by OpenAI/Gemini", Check grades it; a Swiss item gets Dieth-style text. The cost
  meter and spend cap: with the monthly cap reached, transcription is refused with the cap message.
- [ ] Grading: say a ü word as u (Küche → Kuche) → "Sounds to work on: ü sound"; a perfect take → Richtig!.

**Shadowing and TTS rates**

- [ ] Speak item → "Shadowing mode"; dialogue → "Shadow the dialogue": 0.75×, 1× and 1.25× are audibly
  different and keep a natural pitch (Safari: `preservesPitch`); "Listen, then speak" starts recording when
  the model ends; "Loop this line" repeats until "Stop loop".
- [ ] TTS uses a German voice (de-DE; de-CH where installed for ch-std); nothing crashes without German voices.

**Installed PWA and offline**

- [ ] iOS: Add to Home Screen, open standalone, the microphone works there too (separate permission:
  Settings → Doppelpunkt / Safari → Microphone). Android: installed app, same checks.
- [ ] Airplane mode after one visit: /pronunciation lists all 16 drills and opens one; quiz and
  repeat-after-me work (TTS where the OS voice is offline); recording and self-rating work offline; the
  transcribe button fails with a clear error (no network) and self-rating still works.
- [ ] Progress: drill and unit speaking attempts move the Speaking axis of the skill radar; the quiz moves Listening.

### Fixed during QA (v0.3)

| Issue | Fix |
|---|---|
| Swiss German dialogue lines (and Swiss solutions) without a recording had a listen button that read the dialect with a German TTS voice — against the rule "TTS for Standard German only" the Recorder and drills follow. | `GermanText` shows the TTS listen button only for Standard German varieties; Swiss German needs a recording URL (`apps/web/src/components/GermanText.tsx`). |
| Provider transcription bypassed the monthly spend cap (the tracked provider passed `transcribe` straight through). | `trackedProvider` checks the cap before transcribing (`apps/web/src/lib/ai.ts`). |
| Drill list said "1 tries". | "1 try" / "n tries" (`apps/web/src/screens/Pronunciation.tsx`). |
| `docs/CONTENT_FORMAT.md` §9 and `tools/src/pronunciation.ts` used the drill id `ue-u`; the real drill is `ue-u-i`. | Examples and comments say `ue-u-i` (`pron-ue-u-i-pair-01-a.mp3`). |

## v0.4 "A1 komplett"

Exit criteria (ROADMAP): A1 units 10–12; an A1 mock exam (Hören, Lesen, Schreiben, Sprechen), timed, with
solutions; the A1 can-do checklist; WCAG 2.2 AA audit; < 200 KB initial JS and LCP < 2.5 s on 4G. Audio
recording ("all A1 audio recorded and reviewed") is **not** met: coverage is 0 % (see known gaps).

### New automated coverage

| Spec | Tests |
|---|---|
| `exam.spec.ts` | Learn card "A1 mock exam" → `/exam` lists `a1-mock-1` (Goethe format, pass mark) and `a1-schwiiz-1` with Start links; **full run of `a1-mock-1` with `page.clock`**: intro table (11 sections) and the "practice, not an official certificate" note, focus on each section heading, the countdown starts at the section's minutes, listening items show **no transcript text** (neither on screen nor in button names) and "Play item 1" speaks the item transcript in de-DE **without speaker labels**, answers give no Check button, no "Richtig!/Not quite" and no explanation, the clock counts down after a fast-forward, **Pause** hides the items and the clock does not move while 2 minutes pass, Resume, the section **times out** and the exam moves on with the "Time is up for … moved on to …" banner, every other section answered → "Next section" / "Finish the exam", **self-check marking** of the writing and all role-plays (checklist → "Save my score" → "scored by you"), results "Bestanden — passed", the per-section table (11 rows + total, exactly one "(time ran out)"), "(paused 2:0x)", the review shows the item's **transcript**, solution and explanation, the writing "Model answer", then Progress: the A1 mock exam card (latest points, passed, one chip per section), "A1 mock exam passed" on the milestone, "Review the answers" reopens the saved result; **`a1-schwiiz-1`**: Zurich German items say "No recording yet — read instead", show the transcript, have no Play button; every section skipped via the "not answered yet" confirmation → "Nicht bestanden", 4-row table, **zero TTS calls** |
| `listening.spec.ts` | a unit listening mcq with a Standard German transcript: transcript not on screen, "The transcript is shown after you answer", Play speaks it (de-DE / de-CH for ch-std) at 1× and "slower" at 0.75×, after Check the result shows "What you heard" with the transcript; a Zurich German listening item: "No recording yet — read instead" with the transcript, no Play button, no TTS |
| `cando.spec.ts` | seeded IndexedDB: unit 1 done with every exercise right → "Check passed", all its can-do boxes ticked and disabled ("Ticked because you passed the unit check."); unit 2's first statement ticked by hand on Progress, counted in "Can-do statements: n of N", kept after reload and shown on the unit's Check step; all 12 units done → "Units marked as done: 12 of 12" / "A1 mock exam not passed yet", then a passed `a1-mock-1` result → "A1 complete" with "Herzlichen Glückwunsch!" |
| `learn.spec.ts` (+1) | units 10, 11 and 12 are listed (12 units in all) and unit 12 opens on Einstieg |
| `pwa.spec.ts` (extended) | offline after the first visit: the lazy screens `/exam`, `/progress`, `/review`, `/grammar`, `/pronunciation`, `/settings` load from the precache; Learn → mock exam card → `a1-mock-1` → Start shows the running timer offline |

Also: `npm run budget -w @doppelpunkt/web` runs in CI after the build (173.8 KB gzip initial JS of 200 KB at
the time of writing). Unit tests: `src/exercise/Listen.test.tsx` (play without showing, reveal after Check,
gsw "read instead" without TTS, device without TTS, speaker labels stripped), `tools/test/lint.test.ts` and
`tools/test/exam.test.ts` (listening lint), `tools/test/audio.test.ts` (transcript → `ex-<id>` recording,
voice from the first speaker label).

Not automated: real TTS voices and audio files (none recorded yet), real time passing with the screen
locked or the tab in the background (the clock is faked), AI marking of exam writing in the browser
(unit-tested), screen readers, zoom, forced colours, Lighthouse.

### Manual checks for v0.4

**Exam timing on phones** (iOS Safari and Android Chrome, installed PWA and in the browser)

- [ ] Start `a1-mock-1`, lock the screen for 2 minutes in a section, unlock: the clock shows ~2 minutes
  less (it measures wall time, not ticks) and still counts; nothing was lost.
- [ ] Same with the app in the background (switch to another app) for longer than the section's time:
  on return the section has ended, the "Time is up" banner is shown and the answers given are in the results.
- [ ] Pause, lock the screen for 5 minutes, unlock, Resume: the clock did not move; the results show the pause.
- [ ] Reloading or closing the tab mid-exam asks for confirmation (beforeunload); iOS may not show it —
  note what happens.
- [ ] Listening items: Play / Slower read the item (TTS) without the speaker names; the transcript only
  appears in the review; the Swiss check shows "No recording yet — read instead".
- [ ] The sticky section header with the timer does not cover inputs when the on-screen keyboard is open.

**Screen readers**

- [ ] VoiceOver (iOS Safari) and TalkBack (Android Chrome): the section heading is read at the start of
  each section ("Section n of 11: …"); the timer is not announced every second, only at 5 and 1 minute(s)
  left; Pause/Resume are announced; "Play item n" buttons do not read the transcript; results heading is
  focused and the verdict read once.
- [ ] VoiceOver (macOS) / NVDA (Windows): the same, plus the per-section results table is read with
  row/column headers and the review items are navigable by heading (h3 section, h4 item).
- [ ] Can-do checklist on Progress: each unit is a group with its title; auto-ticked boxes are announced
  as checked and dimmed with "Ticked because you passed the unit check".

**Zoom and forced colours**

- [ ] 200 % browser zoom (desktop) and 400 % (1280 px wide → 320 CSS px): Learn, a unit exercise, the exam
  intro, a running section (timer still visible, no horizontal scrolling except the results table), results
  and Progress.
- [ ] Text spacing override (WCAG 1.4.12 bookmarklet): nothing clipped in the exam cards and option buttons.
- [ ] Windows High Contrast / forced colours (Edge): option buttons, the selected option, checkboxes,
  focus rings, the timer's low-time state and the VarietyTag chips (gold = Standard, red = Swiss) stay
  visible; information is never carried by colour alone (passed/failed also in words).
- [ ] Both themes (light/dark) on the exam, results and the milestone card.

**Performance**

- [ ] Lighthouse (mobile, simulated slow 4G, Moto G Power) on the deployed preview: `/learn` first visit
  LCP < 2.5 s, TBT < 200 ms, CLS < 0.1; record the numbers here. Repeat for `/exam/a1-mock-1`.
- [ ] Second visit from the service worker (Lighthouse "warm" or WebPageTest repeat view) is faster than the first.

### Fixed during QA (v0.4)

| Issue | Fix |
|---|---|
| Listening became reading: every `a1-mock-1` / `a1-schwiiz-1` listening item, and 32 Swiss / Standard listening items in units 1–12, quoted what is said in the `prompt`, and both the exam and the unit player show the prompt. | The words moved to the new `transcript` field (with speaker labels) and prompts became short questions (`content/a1/exam/*.yaml`, `content/a1/unit-*/exercises.yaml`). The unit player and exam items play the transcript (recording, else TTS for de / ch-std; gsw without a recording is shown as text, "No recording yet — read instead") and reveal it only in the feedback ("What you heard") or the exam review ("Transcript") — `apps/web/src/exercise/Listen.tsx`. |
| TTS read the speaker labels aloud ("Sprecher: Gespräch 1. Frau: …") for exam stimuli. | `spokenText` strips `Name:` at the start of each line before speaking (stimulus and items). |
| A Swiss German listening recording that fails to load would have fallen back to a German TTS voice. | Listening items use `playNative`, which never speaks gsw with TTS. |
| `a1-u12-match-letters` was tagged `listening` but nothing is heard (it matches written letter names). | Tagged `vocabulary`. |
| Audio manifests: the new `transcript` field was not a recording source, and narrator / generic labels (Sprecher, Mann, Mami …) got guessed voices (e.g. "Mann" read by a female voice). | `exerciseText` uses `transcript` (`ex-<id>`), the first speaker label picks the voice; cast list extended (`tools/src/audio.ts`); scripts regenerated. |
| No lint for listening items that show their text or have nothing to play. | `listeningRules` (`tools/src/rules.ts`), used by unit and exam lint: warns when a listening item quotes text in its prompt, or has no audio, transcript or stimulus (units: a prompt naming the dialogue counts). |
| Pages whose only content is an empty state had no `<h1>` (Review with an empty deck / all caught up, Tutor without a key, unit / grammar point / drill not found, drills failed to load) — against 1.3.1 in `ACCESSIBILITY.md`. | `EmptyState headingLevel={1}` on those screens. |

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

v0.4:

- **No recorded audio** (units 0/1880, exams 0/29, drills 0/504): the roadmap item "all A1 audio recorded
  and reviewed" is open. Standard German listening relies on device TTS; Swiss German listening items and
  the Schwiiz-Check are read, not heard, until recordings exist.
- Two items that ask about the same voicemail (`a1-schwiiz1-l2-*`) have identical transcripts and get two
  manifest entries: record once, copy the file.
- The exam clock is faked in e2e; behaviour with a locked screen / background tab is manual only.
- Lighthouse LCP on 4G, screen readers, zoom and forced colours are manual (checklist above); no numbers
  recorded yet.
- Native review sign-off: 0/12 units.

v0.3:

- **Speech grading accepts umlaut-less number words** (`funf`, `zwolf`, `funfzig` are listed spellings in
  `packages/engine/src/numbers.ts` for typing without umlauts), so a recogniser hearing *funf* gives full
  credit and no ü hint — e.g. `a1-u02-speak-umlaut` ("fünf, fünfzehn, fünfzig. Zwölf …") can't catch u-for-ü.
  Needs an engine decision (strict umlauts for speech).
- Transcription spend is not logged (no token usage); only the cap is enforced. The cost meter ignores it.
- No recorded audio yet: pronunciation audio 0/504, units 0/1429. Swiss drills have no quiz and no native
  model until recordings land; Standard German relies on TTS.
- E2e covers Chromium only: webm recordings, faked recognition, stubbed TTS. iOS/WebKit, mp4, real
  recognisers and Gemini transcription in the browser are manual.

Earlier:

- **Content:** every A1 unit (1–6) now has Bernese items, so the Bern fallback note can't be seen with real
  content (unit-tested in `SwissLane.test.tsx`). No recorded audio yet (audio coverage 0/968; TTS only, Swiss
  lane has none). Native-speaker review pending for all six units (`NATIVE_REVIEW.md`; the lint prints the
  review sign-off summary).
- **Placement:** only A1 is installed, so the e2e run has one section and the adaptive stop between levels
  is covered by unit tests only. The roadmap exit criterion (80% within one unit of a teacher's assessment)
  needs a study with real learners; nothing here measures it.
- **E2e not covered yet:** match / dictation / translate / transform answers graded in the browser
  (inputs checked, grading unit-tested in jsdom), write / role-play flows, export/import, reset, theme
  switching, other AI providers in the browser, relay mode, spend-cap enforcement in the UI, the "Why?" button,
  Ctrl/Cmd+Enter in textareas, the audio tools against real recordings (unit-tested with ffmpeg when present).
- **Not automatable here:** real install prompts, iOS Safari (WebKit is not in the CI matrix), the real
  permission prompt, real speech recognition and TTS voices — see the manual checklists (Chromium's fake
  microphone covers recording since v0.3).
- The e2e Anthropic mock returns the whole SSE body at once; it checks that deltas are assembled, not timing.
- The tutor-with-key test blocks service workers so `page.route` sees the provider request; provider calls are
  not routed through the worker in the app either (cross-origin, no matching Workbox route).
- Locally the e2e config reuses an existing `dist/`; a stale build gives confusing failures — rebuild first.
