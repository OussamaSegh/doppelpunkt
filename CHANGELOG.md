# Changelog

## 0.4.0 "A1 komplett"

- A1 units 10–12: all 12 A1 units written
- Mock exams: A1 in Goethe Start Deutsch 1 format and a Zurich German check; timed runner, marking, results and review
- A1 can-do checklist and "A1 complete" milestone
- Accessibility fixes (contrast, headings, focus, live regions, target sizes) and `docs/ACCESSIBILITY.md`
- Lazy-loaded screens; initial JS 174 KB gzip with a CI budget check
- Listening items play a hidden `transcript` instead of showing it
- Audio CDN upload with SigV4, `docs/DEPLOY.md`; transcription cost tracking
- 365 unit tests, 122 e2e tests

## 0.3.0 "Stimme"

- Recorder with live waveform, playback next to native audio, mic-permission help per platform
- Recognition: browser speech recognition, then OpenAI/Gemini transcription, then self-rating
- Speech-tolerant grading (numbers, fillers, split compounds) with "sounds to work on" hints
- Shadowing at 0.75×/1×/1.25×, listen-then-speak, loop, line-by-line dialogue shadowing
- Pronunciation screen with 16 drills, minimal-pair quiz and repeat-after-me
- Content: A1 units 7–9, docs/PRONUNCIATION.md
- Swiss German without a recording never falls back to a German synthetic voice
- 311 unit tests, 106 e2e tests

## 0.2.0 "Erste Schritte"

- Placement test with sections, adaptive stop and a plain-English result; result shown on Progress
- Exercise player: umlaut bar, keyboard shortcuts, vibration, "Almost!" state, retry, session summary
- Grammar reference with accent-insensitive search
- Bernese home dialect: Bernese items first in the Swiss lane
- Audio pipeline (`audio:scripts`, `audio:process`, `audio:link`), recording guide `docs/AUDIO.md`
- `content:report`, review sign-off metadata, lexicon validation, mcq-position lint
- Content: A1 units 4–6, 18 Bernese exercises, Swiss forms checked against online sources
- 222 unit tests, 72 e2e tests; CI runs on every PR and checks audio manifests

## 0.1.0 "Fundament"

First working version: monorepo, content schema, engine, AI tutors (Claude, ChatGPT, Gemini, Grok),
installable PWA, A1 units 1–3, full syllabus, CI. See `docs/ROADMAP.md`.
