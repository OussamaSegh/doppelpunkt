# Doppelpunkt roadmap

Versions follow [Semantic Versioning](https://semver.org). Until 1.0 the content format may change
between minor versions; from 1.0 it only changes in major versions. Each version below lists its
goal, scope, the team roles involved, and the exit criteria that must be true before it ships.

Content speed, not code, sets the pace. Dates assume a small core team: one full-stack developer,
one lead German author, a part-time Swiss German consultant and a part-time designer. Month 0 is
the start of v0.1 (November 2026).

| Version | Name | Target | Headline |
|---|---|---|---|
| 0.1 | Fundament | Month 1 | Skeleton app, content format, A1 units 1–3, BYOK tutors |
| 0.2 | Erste Schritte | Month 2 | Placement test, polished exercise player, audio pipeline |
| 0.3 | Stimme | Month 3 | Speaking: recording, recognition, pronunciation drills |
| 0.4 | A1 komplett | Month 4–5 | All 12 A1 units with studio audio, A1 mock exam |
| 0.5 | Beta | Month 5 | Closed beta with 50 learners, analytics without tracking |
| 1.0 | Ankommen | Month 7 | Public launch: A1 + A2, payments, Book 1 |
| 1.1 | Sync | Month 8 | Optional account and cross-device sync |
| 1.2 | Gespräch | Month 9 | Voice role-plays, writing coach with error profile v2 |
| 1.3 | Mitreden B1 | Month 11 | B1, active Swiss German speaking, Bernese option |
| 1.4 | Mitreden B2 | Month 14 | B2, Swiss companion book, Grammatik kompakt |
| 1.5 | Schule | Month 15 | Teacher dashboard and classes |
| 2.0 | Meistern | Month 20–24 | C1 + C2, multi-dialect listening, Books 2 and 3, store builds |

---

## v0.1 "Fundament" (this release)

**Goal:** prove the whole loop end to end on real content: author YAML → lint → pack → learn in the
app → progress → AI tutor.

- [x] Monorepo: `apps/web`, `packages/{content-schema,engine,ai}`, `services/relay`, `tools`, `content`
- [x] Content schema (zod) for units, vocabulary, ten exercise types, grammar points, Swiss lane
- [x] Content linter and pack builder (`npm run content:lint`, `npm run content:build`)
- [x] Engine: graders with German-aware normalisation (ß/ss, umlaut fallback, noun capitalisation,
      Swiss spelling tolerance), word diff, FSRS spaced repetition, skill estimates, error profile,
      placement rule
- [x] AI: adapters for Anthropic Claude, OpenAI, Google Gemini and xAI Grok, streaming, structured
      JSON with validation, encrypted on-device key vault, cost estimate, four tutor personas
- [x] Optional stateless relay (Cloudflare Worker) for providers that block browser calls
- [x] PWA: installable, offline shell, learn / unit / exercise player / review / tutor / progress / settings
- [x] Content: full A1–C2 syllabus (`docs/CURRICULUM.md`), A1 units 1–3, Zurich German lexicon
- [x] QA: unit tests, Playwright smoke tests, GitHub Actions CI

**Exit criteria:** CI green (typecheck, unit tests, content lint, build, e2e); app installs on
Android Chrome and iOS Safari; a learner can finish A1 unit 1 offline without any API key.

**Known gaps:** no recorded audio (TTS fallback for Standard German only, Swiss lane is text +
TTS-less), native-speaker review of content still pending, no accounts.

## v0.2 "Erste Schritte"

**Goal:** a first-time learner lands at the right place and every exercise feels finished.

- [x] Adaptive placement test (~25 min) using `engine.placeLearner`, result explained in plain English
- [x] Exercise player polish: umlaut/ß buttons, keyboard, haptics, retry flow, "almost" state, session summary
- [x] Audio pipeline in `tools/`: scripts + manifests per unit, file naming, loudness normalisation,
      MP3/Opus encode, auto-linking, coverage in lint
- [ ] CDN upload for audio (moved to v0.4)
- [ ] Record A1 units 1–6 (needs voice actors: scripts are ready in `content/a1/unit-*/audio-script.md`)
- [x] Grammar reference screen (search across all grammar points)
- [x] Content: A1 units 4–6, Bernese recognition items in units 1–6, Swiss forms checked against online sources
- [x] Native review sign-off process (`review` metadata in unit.yaml, `npm run content:report`)

**Roles:** frontend, content tooling, language expert, audio producer, QA.
**Exit:** placement puts 80% of test users within one unit of a teacher's assessment (measured in the v0.5 beta).

## v0.3 "Stimme"

**Goal:** speaking practice that works on every phone.

- Recording with waveform, playback next to native audio
- Speech recognition: Web Speech API where available, provider transcription (OpenAI, Gemini) as fallback
- Pronunciation drills: ü/ö, ich-/ach-Laut, r, final devoicing, vowel length; Swiss "ch" and "gg"
- Shadowing mode with adjustable speed (0.75×–1.25×)
- Speaking scores feed the skill radar
- Content: A1 units 7–9

**Exit:** speaking exercises usable on iOS Safari, Android Chrome and desktop; recognition fallback tested.

## v0.4 "A1 komplett"

- A1 units 10–12, all A1 audio recorded and reviewed
- A1 mock exam (original items in Goethe/telc/ÖSD format: Hören, Lesen, Schreiben, Sprechen), timed, with solutions
- Can-do checklist for A1 complete
- Accessibility audit (WCAG 2.2 AA), performance budget (< 200 KB JS initial, LCP < 2.5 s on 4G)

## v0.5 "Beta"

- Closed beta with 50 learners; in-app feedback form per exercise ("this is wrong / unclear")
- Privacy-friendly, opt-in analytics on item difficulty (no personal data, aggregated)
- Item statistics report in `tools/` to find bad exercises
- Crash reporting (opt-in)

**Exit:** 4-week retention ≥ 35% in the beta; < 1% of items flagged as wrong after fixes.

## v1.0 "Ankommen" (public launch)

- A2 units 1–12 with audio; Swiss lane introduces no-Präteritum, "go + infinitive", -li diminutives
- A2 mock exam
- Payments: A1 free, A2+ per level or yearly; book access codes
- **Book 1 "Doppelpunkt 1: Ankommen" (A1–A2)** + answer key (PDF free), built from the same content with Typst
- Landing page, onboarding video, store listing assets
- Legal: privacy policy, terms, imprint (Swiss/EU)

**Exit:** content reviewed by two German and one Swiss native reviewer; book proofread; CI green.

## v1.1 "Sync"

- Optional account (Supabase auth), end-to-end encrypted progress sync across devices
- Keys stay local by default; optional encrypted key sync
- Export/import remains for users without accounts

## v1.2 "Gespräch"

- Voice role-plays (speech in, TTS out) with Lena and Reto
- Writing coach v2: error taxonomy trends, personalised review sessions from errors
- AI practice generator with human-reviewed templates per grammar point
- Spend caps per day/month per provider

## v1.3 "Mitreden B1"

- B1 units 1–12; Swiss lane: active dialect speaking (small talk, phone calls, appointments)
- Bernese (gsw-be) as an alternative home dialect: lexicon, audio, graders
- B1 mock exam

## v1.4 "Mitreden B2"

- B2 units 1–12, B2 mock exam
- **Book 2 "Mitreden" (B1–B2)**, **"Schwiizerdütsch: Das Begleitbuch"**, **"Grammatik kompakt"**
- Authentic texts (licensed or public domain) for reading

## v1.5 "Schule"

- Teacher dashboard: classes, assignments, progress overview, export
- School licensing

## v2.0 "Meistern"

- C1 + C2 units (24), mock exams
- Multi-dialect listening: Basel, Lucerne, St. Gallen
- **Book 3 "Meistern" (C1–C2)**
- Capacitor builds for the App Store and Google Play
- Content format 2.0 (frozen until 3.0)

---

## Working agreements

- One pull request per feature; CI must be green; at least one review.
- Content changes need a language review; Swiss lane changes need the Swiss consultant.
- Every release: changelog entry in `CHANGELOG.md`, version bump in the root `package.json`, git tag `vX.Y.Z`.
- Issues are labelled by role: `frontend`, `engine`, `ai`, `content`, `swiss`, `qa`, `books`, `design`.
