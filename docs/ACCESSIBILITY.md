# Accessibility — WCAG 2.2 AA audit (v0.4)

Target: **WCAG 2.2 level AA** on every screen, in the light and dark themes, on phones and desktop.
This is the v0.4 audit from the roadmap ("Accessibility audit (WCAG 2.2 AA)"). It was done by
reading the code of every screen and component in `apps/web/src`, plus a script that computes the
contrast of the colour tokens. axe-core is not a dependency, so there is no automated rule scan yet;
see [What still needs a person](#what-still-needs-a-person).

## How to re-check

- **Contrast:** every text/background pair the UI uses is listed in a small Node script (kept outside
  the repo during the audit; the table below is its output). When you change a token in
  `apps/web/src/index.css`, recompute the pairs you touched with any WCAG contrast checker and update
  the table. Text needs 4.5:1, large text, icons, borders of controls and the focus ring 3:1.
- **Keyboard:** unplug the mouse. Tab through each screen in the list below; the focus ring must be
  visible on every stop, the order must follow the visual order, and nothing may trap focus.
- **Screen reader:** VoiceOver (iOS/macOS) or NVDA (Windows) over the screens below; German must be
  read with a German voice (`lang` attributes) and variety tags announced ("Zurich German").
- **Reduced motion:** turn on "Reduce motion" (iOS/macOS), "Remove animations" (Android) or
  "Show animations: off" (Windows) and record a speaking item: no waveform animation, no pulsing dot,
  no vibration.

## Colour contrast

Gold = Standard German and red = Swiss German stay as brand colours; text uses the `-strong` variants
on the `-soft` backgrounds. Ratios below are after the fixes.

| Pair (foreground on background) | Used for | Light | Dark |
|---|---|---|---|
| fg on bg / surface / surface-2 | body text | 15.5 / 16.5 / 14.3 | 15.4 / 13.9 / 12.4 |
| muted on bg / surface / surface-2 | secondary text, labels, placeholders | 5.8 / 6.1 / 5.3 | 7.8 / 7.0 / 6.2 |
| accent on surface / bg / accent-soft | links, selected options, chips | 8.0 / 7.5 / 6.5 | 7.4 / 8.3 / 6.4 |
| gold-strong on gold-soft | DE tag, "Start here" badge | 4.8 | 8.7 |
| gold-strong on surface | gold text on cards | 5.7 | 10.7 |
| swiss-strong on swiss-soft | CH / ZH / BE tags | 6.1 | 7.1 |
| swiss-strong on surface / bg | Swiss lane headings and chips | 7.9 / 7.4 | 7.9 / 8.8 |
| swiss on surface | `text-swiss` | 5.6 | 5.3 |
| ok on ok-soft / surface | right answers, "Done" badges | **4.9** / 5.8 (was 4.5 / 5.3) | 6.7 / 7.9 |
| bad on bad-soft / surface / surface-2 | wrong answers, errors, timer warning | 5.4 / 6.5 / 5.7 | 6.7 / 7.1 / 6.3 |
| der / die / das on surface | noun gender colours | 5.8 / 5.6 / **5.4** (was 4.4) | 6.8 / 6.4 / 8.7 |
| white on ink · white on accent | primary button, active chip (light) | 14.2 · 8.0 | — |
| ink on accent · ink on gold | primary button and hover (dark) | — | 6.5 · 7.1 |
| white on swiss (light) · ink on swiss (dark) | active Swiss chip, due badge, Stop recording | 5.6 | **4.6** (was white: 3.1) |
| gold on surface (graphic) | daily-goal bars | 3.7 | 8.1 |
| accent on surface / bg (focus ring) | `:focus-visible` outline | 8.0 / 7.5 | 7.4 / 8.3 |

Fixes:

- `--dp-das` (light) `#1f8a4c` → `#187a42`: "das" nouns were 4.38:1 on white.
- `--dp-ok` (light) `#1f7a4a` → `#1d7445`: right-answer text on the green panel was exactly 4.51:1, no margin.
- Dark theme: white text on the red `--dp-swiss` was 3.09:1 (active Swiss-lane step chip, Review due
  badge). Those now use ink text in dark mode (`dark:text-ink`, 4.59:1). The red token itself is unchanged,
  because it also has to work as text on the dark surface (5.25:1).

Not text, so not bound by 1.4.3: disabled controls (`opacity-50`, exempt), the decorative gold/red dots
in empty states, the waveform canvas.

## Findings and fixes by area

### Whole app (Layout, routing)

| Check | Finding | Fix |
|---|---|---|
| Landmarks | Skip link → `<main id="main">`, `<nav aria-label="Main">` (sidebar on desktop, tab bar on phones — only one is displayed at a time), `<nav aria-label="Reference">`, `<header>` on phones. OK. | `main` now has `tabIndex=-1` so the skip link and route changes can focus it. |
| 2.4.2 Page titled | Every route had the title "Doppelpunkt". | Title per route: "Learn · Doppelpunkt", "Mock exam · Doppelpunkt", … (`useRouteA11y` in `Layout.tsx`). |
| 2.4.3 Focus order on navigation | After a navigation that removes the focused button (e.g. "Start here", "Next section"), focus fell back to `<body>`. | Focus moves to `<main>` when the focused element disappeared. Containers/headings focused this way show no ring (`[tabindex="-1"]:focus-visible`), and keyboard shortcuts treat them like "nothing focused" (`lib/keys.ts`). |
| 2.4.7 / 2.4.11 Focus visible, not obscured | Global 3px accent outline with offset on `:focus-visible`; ≥ 7:1 against both themes. The sticky exam timer bar is short (one line) and the fixed tab bar is at the bottom; `main` has `pb-28` so focused items are never fully hidden. OK. | — |
| 1.3.1 Headings | Learn and the not-found page had no `<h1>`. | Learn: visually hidden `<h1>Learn A1</h1>`. `EmptyState` takes `headingLevel={1}` for not-found pages (unit, exam, result, any URL). The not-found title was German without `lang`; it is now "Page not found". |
| 3.1.2 Language of parts | `<html lang="en">`; German text carries `lang="de-DE"`, `de-CH` or `gsw-CH` via `GermanText`, `VarietyTag` and the inputs. OK. | Exam answers, model answers and the review use the item's `lang` too. |
| 1.4.10 Reflow | Single column at 320 px; tables are narrow (≤ 4 columns); the Learn level strip and unit-step strip scroll horizontally on purpose. OK. | — |
| 2.3.3 / reduced motion | Global CSS turns animations and transitions off under `prefers-reduced-motion`; haptics are off too. The microphone waveform (canvas, `requestAnimationFrame`) still moved. | The waveform is hidden and not drawn with reduced motion; the level bar (`role="meter"`) still shows the input level. Pulsing dots get `motion-reduce:animate-none`. |
| 2.5.8 Target size (minimum 24×24) | Buttons are ≥ 32 px (listen buttons 32 px, umlaut keys 36 px, chips ≥ 28 px). Checkboxes and radios were 16 px; their labels make the target larger but single-line labels were only 20 px tall. | Checkboxes and radios are 20 px with the label as part of the target; new checklists use `min-h-6` (24 px) labels. Inline text links (e.g. "review") are exempt. |
| Keyboard traps | No modal dialogs in the app (no `role="dialog"`); `<details>`, the chat and the exam have no focus traps. The chat log is scrollable and now focusable (`tabIndex=0`) so it can be scrolled from the keyboard. | — |

### Learn, unit steps, exercise player

- Exercise cards are `<article aria-labelledby>` with the prompt as `<h3>`; results are a polite live
  region (`Feedback`), "Answer saved." is `role="status"`. Number-key shortcuts announce themselves via
  `aria-keyshortcuts`. OK.
- Multiple choice uses `role="radiogroup"`/`role="radio"` with `aria-checked`; word order and match use
  buttons with names ("Remove Ich", "→ hello / not matched"). OK.
- Variety tags are `role="img"` with the full variety name. OK.
- Mock exam card on Learn: a link with a visible name ("A1 mock exam") and description.

### Mock exam (new in v0.4)

- One `<h1>` per phase (intro, exam title, result); sections are `<h2>` (with "Section n of m" for
  screen readers), stimulus and items `<h3>`, review items `<h4>`. Focus moves to the section heading at
  the start of each section and to the result heading at the end.
- **Timer:** `role="timer"` (implicitly `aria-live="off"`), so it is not read every second. Its
  accessible name holds the spoken time ("Time left in this section: 4 minutes 30 seconds") for anyone
  who navigates to it. A separate polite live region says "5 minutes left" (sections over 10 minutes),
  "1 minute left", "Paused. The clock has stopped." and "Resumed." Under one minute the timer turns red
  *and* a sentence says so (colour is not the only cue).
- **Time out (2.2.1 Timing adjustable):** the exam is timed by design, as the real exam is; it can be
  paused at any time and the pause is unlimited, which satisfies 2.2.1 for a practice test. When time runs
  out the exam moves on and says so in a `role="status"` banner on the next section.
- Moving on with unanswered items asks first, inline (no modal): "2 items are not answered yet…"
  with "Yes, go on" / "Keep working".
- Several items share one page, so page-wide number-key shortcuts are off inside the exam
  (`PageWideKeys` context); with focus in a multiple-choice item the keys still work.
- Listening sections: "Play the recording" / "Slower" buttons; when a Swiss German recording is missing
  the transcript is shown instead (no TTS voice speaks dialect).
- Results: points per section in a `<table>` with `<caption>`, row headers and a total row; pass/fail
  is stated in words ("You didn't pass this time… 1.5 points short"), not only by colour.

### Progress

- The A1 can-do list is one `<fieldset>`/`<legend>` per unit with real checkboxes. Auto-ticked
  statements are disabled checkboxes described by "Ticked because you passed the unit check"
  (`aria-describedby`). Milestone lines use ✓/○ glyphs hidden from screen readers plus "(done)" /
  "(not yet)" text.
- Only one `<table>` on the page (skills); the exam card uses a list.

### Speaking, pronunciation, recorder

- Recorder errors are `role="alert"`; "Recording 0:03 / 0:10" is `role="timer" aria-live="off"`; the
  microphone level is `role="meter"` with a value. OK.
- The "native" model can be hidden (`showNative={false}`, used in the exam).

### Tutor and chat

- The conversation was a polite live region that re-announced on every streamed chunk.
  It is now `role="log"` with `aria-busy` while a reply streams, so the finished reply is read once.
- The cost meter `div` had an `aria-label` without a role (not exposed); it is now `role="group"`.

### Settings, onboarding, review

- Every input has a `<label for>`; radio groups have names ("Theme", "Card direction", the onboarding
  headings). Status messages ("Key saved and unlocked.") are `role="status"`. OK.

## What still needs a person

- An **axe-core / Lighthouse pass** in CI (not installed; adding a dev dependency was out of scope for
  v0.4). Suggested: `@axe-core/playwright` over the e2e journeys, failing on serious/critical issues.
- **Screen reader runs** of the mock exam with VoiceOver on iOS and TalkBack on Android: the live
  announcements at 5 and 1 minute(s), the time-out banner, the self-assessment checklist.
- **Zoom 200% and 400%** on desktop and **text spacing** (1.4.12) with a bookmarklet.
- **Windows High Contrast / forced colours:** chips and tags rely on borders, which forced colours keep,
  but check the exam timer and the progress bars.
- The unit-step strip and level strip scroll sideways on phones; check that the active step is
  scrolled into view.

## Notes for developers

- Add new colours as tokens in `index.css` for **both** themes and check text pairs at 4.5:1.
- Give every new screen one `<h1>`; use `EmptyState headingLevel={1}` when the empty state is the page.
- Timers: `role="timer"` plus a separate polite region for milestones, never `aria-live` on a ticking value.
- Prefer inline confirmation over modal dialogs; if a dialog is ever needed, use `<dialog>` with
  `showModal()` (native focus handling, Escape closes).
