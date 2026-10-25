# Mock exams

Doppelpunkt ships practice exams for each level in `content/<level>/exam/<id>.yaml`, one `MockExam`
per file (schema: `packages/content-schema/src/index.ts`; authoring rules: `docs/CONTENT_FORMAT.md`,
section 10). They let a learner check, under exam conditions, whether the level is in place.

> **Disclaimer.** Doppelpunkt mock exams are **not official exams** and are not endorsed by the
> Goethe-Institut, telc gGmbH or ÖSD. A pass in the app is **not a certificate** and does not
> predict an official result. The format (sections, timing, task types, points) follows the public
> descriptions listed below; **every text, item, voicemail and dialogue is our own**. Learners who
> need a certificate should book the real exam and use the publisher's free model papers as well.

## Current exams

| File | Level | Format | Sections | Items | Points | Time | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `content/a1/exam/a1-mock-1.yaml` | A1 | `goethe` | Hören 3 + Lesen 3 + Schreiben 2 + Sprechen 3 | 37 | 60 | 65 min written + 15 min speaking | draft, needs native review |
| `content/a1/exam/a1-schwiiz-1.yaml` | A1 | `generic` | Lose 2 + Läse 2 (Zurich German) | 17 | 21 | 20 min | draft, needs Zurich native review |

## How a mock exam is built

1. **Pick the exam family and copy its shape, never its content.** Use the public format
   description (below) for the number of parts, items per part, answer formats, timing and points.
   Write every stimulus and item from scratch with our own people, places and situations.
   `docs/CONTENT_FORMAT.md` rule 8 applies: no copying, adapting or paraphrasing of publisher items,
   model papers or audio scripts.
2. **One section per exam part (Teil).** A section has one shared `stimulus` (the texts or the
   transcript of all recordings of that part, numbered *Gespräch 1, Durchsage 1, Schild 1 ...*) and
   its items. The section `instructions` start with the German rubric line in italics, as on real
   papers, followed by the English explanation and how often the recording is played in the real
   exam. The first section repeats the disclaimer.
3. **Level control.** Only vocabulary and grammar from the level's units (for A1: units 1–12) plus
   transparent internationalisms. Swiss settings are welcome; Swiss texts are tagged `ch-std` and
   written with Swiss spelling, German ones `de`.
4. **Every item is gradable and explained.** Closed items (mcq, gap, match, transform) have stored
   solutions that pass `npm run content:lint` (the real grader runs on each). Each has an English
   `explanation` that says where the answer is in the text and why the distractor is wrong. Tag
   items with grammar ids so the results screen can link lost points to the unit that teaches them.
5. **Distractors follow the exam's logic**: a number that is mentioned but corrected (*nicht um
   sieben – um acht*), a word that appears in the text with another meaning (*Gartenstraße* vs
   *Garten*), *nicht / kein*, near numbers (59 / 95). Vary the position of the right option.
6. **Open tasks** (`write`, `speak`, `roleplay`) have a model answer and a checklist / goals that
   mirror the official criteria (content points, task fulfilment, greeting and closing). They are
   scored 0–1 × points by the AI tutor or by the learner's self-assessment; the engine
   (`packages/engine/src/exam.ts`) multiplies by the item's points.
7. **Points and pass mark.** `points` per item mirrors the official weighting; `passMark` is the
   official fraction (0.6 for Goethe / telc A1). Run `npm run content:lint`; the exam linter checks
   ids, points, timing ranges and skills.
8. **Audio.** Until studio recordings exist, `de` and `ch-std` listening stimuli are read by the
   device's TTS (hidden text, transcript shown in the review); `gsw-*` stimuli have no TTS and are
   shown as text with a "read once, then answer" instruction. `npm run audio:scripts` lists the
   stimuli to record (`content/<level>/exam/audio-script.md`).

## Format notes per exam family (A1)

Format facts only; checked on 2026-10-25 from the public pages listed under *Sources*.

### Goethe-Zertifikat A1: Start Deutsch 1 (`format: goethe`)

| Module | Time | Parts | Task types (format only) | Raw points |
| --- | --- | --- | --- | --- |
| Hören | ≈ 20 min | 3 | Teil 1: 6 short everyday conversations, a/b/c, heard twice · Teil 2: 4 public announcements, richtig/falsch, heard **once** · Teil 3: 5 phone messages, a/b/c, heard twice | 15 (1 per item) |
| Lesen | 25 min | 3 | Teil 1: 2 short texts (a personal message, a notice), 5 × richtig/falsch · Teil 2: 5 situations, choose the matching ad or web entry a/b · Teil 3: 5 signs and notices, richtig/falsch | 15 |
| Schreiben | 20 min | 2 | Teil 1: complete a form with 5 details from a short text · Teil 2: a short message of about 30 words covering 3 given points, with greeting and closing | 15 (5 + 10) |
| Sprechen | ≈ 15 min | 3 | Group exam with two examiners. Teil 1: introduce yourself from key words, spell a name, say a number · Teil 2: ask and answer questions on a topic with word cards · Teil 3: make requests from picture cards and react | 15 (3 + 6 + 6) |

- **Scoring:** each module's raw points (max 15) are multiplied by 1.66 and added (75 written + 25
  oral = 100). Writing Teil 2 is scored per content point (3 / 1.5 / 0) plus 1 point for text
  conventions; speaking tasks get full, half or no marks. **Pass: 60 of 100**, provided all parts were
  taken. Grades: 90–100 sehr gut, 80–89 gut, 70–79 befriedigend, 60–69 ausreichend.
- **telc Deutsch A1** (the same Start Deutsch 1 exam, carried jointly by the Goethe-Institut and
  telc) uses the same structure with raw points: 45 written (Hören 15, Lesen 15, Schreiben 15) + 15
  oral = 60; the lowest passing band starts at 36 (= 60 %).
- **Doppelpunkt mapping (`a1-mock-1`):** 11 sections (one per Teil), raw points as above (15 per
  module, 60 in total), `passMark: 0.6` → 36 points. Because every module has the same maximum, the
  ratio equals the Goethe 100-point scale (×1.66 per module). Hören Teil 1/2/3 = 7/5/8 min, Lesen
  8/9/8, Schreiben 8/12, Sprechen 4/5/6. The group speaking exam becomes roleplays with Frau Keller
  (Teil 1) and Lena as the partner (Teile 2 and 3); each speaking task is scored 0–3.

### telc Deutsch A1 (`format: telc`)

See above: telc Deutsch A1 is Start Deutsch 1. The written part takes about 65 minutes (Hören ≈ 20,
Lesen and Schreiben together 45) plus 10 minutes of formalities; the oral part about 15 minutes (Teil
1 ≈ 3, Teil 2 ≈ 4, Teil 3 ≈ 4 minutes, plus examiner time). A future `format: telc` mock would use
the same item counts and the 60-point raw total.

### ÖSD Zertifikat A1 (`format: osd`)

| Module | Time | Tasks (format only) | Points |
| --- | --- | --- | --- |
| Lesen | 25 min | 3 tasks: matching (5 items), richtig/falsch or ja/nein on 3 short texts (6 items), matching (5 items) | 30 |
| Hören | ≈ 10 min | 3 tasks: match short recordings to pictures (5, heard once), complete notes (5, heard twice), tick a grid for 5 short interviews (heard once) | 30 |
| Schreiben | 20 min | complete a form (10 entries, choice and fill-in, 5 points); reply to an email answering 3 guiding questions, about 30 words (10 points) | 15 |
| Sprechen | ≈ 10 min + 10 min preparation | individual exam: introduce yourself on 4 of 6 topics; describe one of 3 photos with 4 simple questions; a role play on the photo with the examiner | 25 |

- Written module 75 points, oral module 25. **Pass:** at least 38 of 75 in the written module (with
  minimums in Lesen, Hören and Schreiben Task 2) and at least 12 of 25 in the oral module. The modules
  can be taken separately. Texts come from Austria, Germany and Switzerland – a good fit for
  Doppelpunkt's Swiss settings. A future `format: osd` mock needs picture-matching items, which the
  schema does not have yet (they would be mcq with described pictures for now).

### Doppelpunkt Swiss track check (`format: generic`, `a1-schwiiz-1`)

**There is no official exam for Swiss German** (Zurich or Bernese). The *Schwiiz-Check* is
Doppelpunkt's own test of the Swiss lane: at A1 the lane teaches recognition only, so the check has
listening and reading only (20 minutes, 21 points, pass at 60 %):

- *Lose, Teil 1*: a conversation in a Zurich bakery, 5 × a/b/c/d (prices, numbers, Twint, days).
- *Lose, Teil 2*: two voice messages, 4 × richtig/falsch (times with *am halbi achti*, *nöd*).
- *Läse, Teil 1*: a group chat written in dialect (Swiss people text in dialect), 4 × mcq + 1 gsw → de
  transform.
- *Läse, Teil 2*: a 5-pair matching item (1 point per pair) and two gsw → de transforms.

Learners never have to produce dialect. Answers in Standard German accept several word orders.
The exam linter reports three warnings for this file (no writing or speaking section, 20 minutes is
below the A1 written range); they are expected for a recognition-only check.

## Scoring in the app

- `scoreExam()` (`packages/engine/src/exam.ts`) grades closed items with the same grader as the
  units: a gap item with 4 of 5 gaps right earns 4/5 of its points; near misses earn partial credit.
- Open items take a 0..1 score from AI feedback or self-assessment against the checklist; a speaking
  item with a recognised transcript and no other score is compared with its model text.
- `passed` = total / max ≥ `passMark`. The results screen shows points per section and links lost
  points to the grammar points (and units) that teach them.

## Sources

| Key | Source (format information only) |
| --- | --- |
| GI-INFO | Goethe-Institut, *Goethe-Zertifikat A1: Start Deutsch 1 – Weitere Informationen* (modules and timing): https://www.goethe.de/ins/gb/de/m/sta/gla/prf/gzsd1/inf.html |
| GI-UEB | Goethe-Institut, *Start Deutsch 1 Übungssatz 01* – read for structure only (parts, item counts, answer formats, how often recordings are played, scoring of Schreiben Teil 2 and Sprechen): https://www.goethe.de/pro/relaunch/prf/materialien/A1_sd1/sd_1_uebungssatz01.pdf |
| GI-DB | Goethe-Institut, *Durchführungsbestimmungen A1: Start Deutsch 1* (raw points, ×1.66 weighting, pass mark 60, grades), copy hosted by Université de Strasbourg: https://lansad.unistra.fr/websites/lge/LANSAD/CERTIFICATIONS/Cellule_de_certifications_en_langues/Durchfuehrungsbestimmungen_A1_Start_Deutsch_1.pdf |
| TELC | telc gGmbH, *A1 Übungstest 1 Start Deutsch 1* (structure, timing, 45 + 15 points, grade bands; joint exam with the Goethe-Institut): https://shop.telc.net/media/catalog/product/file//2/0/20210103_5070-b00-010106_web_1.pdf |
| KLETT | Klett Sprachen, exam overview pages for Start Deutsch 1 / telc A1 (timing): https://www.klett-sprachen.de/c-2555, https://www.klett-sprachen.de/c-2557 |
| OSD-F | ÖSD, *Zertifikat A1 (ZA1) folder* (modules, timing, individual oral exam): https://www.osd.at/wp-content/uploads/2024/02/ZA1_Folder.pdf |
| OSD-M | ÖSD, *ZA1 Modellsatz brochure* (tasks, item counts, points, pass marks): https://www.osd.at/wp-content/uploads/2024/09/ZA1-Modellsatzbroschure_WEB.pdf |
| CEFR | Council of Europe, *Common European Framework of Reference – global scale and self-assessment grid* (A1 descriptors used for the can-do mapping in docs/CURRICULUM.md): https://rm.coe.int/168045b15e |

The Goethe test description PDF (*Prüfungsziele, Testbeschreibung A1*) could not be read from the
review environment (binary download blocked), so the item counts come from GI-UEB and TELC, which
agree.

## Open questions

- A reviewer with exam experience (Goethe / telc examiner) should check that the difficulty of
  `a1-mock-1` matches the real A1 paper, especially Lesen Teil 2 (ads) and the speaking cards.
- Should the app present the 11 sections of `a1-mock-1` grouped as four modules (Hören, Lesen,
  Schreiben, Sprechen) with one timer each, as in the real exam?
- ÖSD-style picture tasks need an image field in the schema (proposal for v0.5).
