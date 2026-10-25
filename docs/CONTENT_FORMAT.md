# Content format: author's guide

This guide explains how to write Doppelpunkt course content in YAML. The contract is
`packages/content-schema/src/index.ts`. If this guide and the schema ever disagree, the schema
wins, and this guide should be fixed. Run `npm run content:lint` before every commit. It validates
the schema, checks the editorial rules below, and runs the real grader on every stored solution.

## 1. Folder layout

```
content/
  a1/
    unit-01/
      unit.yaml        # one Unit: intro, grammar, reading, Swiss lane
      vocab.yaml       # a list of VocabItem
      exercises.yaml   # a list of Exercise (discriminated by `type`)
      audio/           # optional, added when recorded (audio fields stay omitted until then)
  lexicon/
    gsw-zh.yaml        # Standard German → Zurich German core lexicon (with Bernese where different)
  pronunciation/
    ue-u-i.yaml        # one PronunciationDrill per file, file name = id (section 9, docs/PRONUNCIATION.md)
```

- Unit folders are `unit-NN` with two digits. The unit `id` is `<level>-u<NN>`, for example `a1-u01`.
- All ids are lowercase kebab-case (`a1-u02-gap-accusative`). Exercise, vocab and grammar ids must
  be unique within a level. Prefix exercise ids with the unit id, and use the infix `-ch-` for
  Swiss-lane items (`a1-u01-ch-mcq-gruezi`) and `-ch-be-` for Bernese items (`a1-u04-ch-be-match-days`).
- `docs/CURRICULUM.md` is the syllabus. A unit must match its entry there: title, grammar and Swiss focus.

## 2. Varieties

Every German sentence has a variety. Exercises and dialogue lines default to `de`.

| Tag      | What it is                                | Colour in the app |
|----------|-------------------------------------------|-------------------|
| `de`     | Standard German, Germany spelling (ß)     | gold              |
| `ch-std` | Swiss Standard German: no ß, Helvetisms   | gold              |
| `gsw-zh` | Zurich German (home dialect)              | red               |
| `gsw-be` | Bernese German (alternative dialect, B1+) | red               |

- **Swiss Standard German is still Standard German.** Use `ch-std` for an item whose point is a
  Helvetism or the Swiss spelling (Velo, Trottoir, parkieren, Billett, Znüni, Natel/Handy, Poulet,
  Glace, Gipfeli, Götti; `ss` for `ß`). In vocabulary, put the Helvetism in `chStd`.
- **Accept both spellings.** In `de` answers, also list the `ss` spelling when the model answer has ß
  (`["heißt", "heisst"]`).
- **Dialect is never written in a `de` item, and Standard German is never written in a `gsw-*` line.**
  A learner may answer in Standard German inside a `gsw-zh` roleplay. That is realistic in Switzerland.

## 3. Writing Swiss German (Dieth-style spelling)

Swiss German has no official spelling. Write it the way Swiss people text, following Dieth's
principles: write what you hear, close to Standard German letters.

- Long vowels are doubled: `Huus`, `Ziit`, `nüün`, `zää`, `gaa`. Short vowels are single: `Chind`, `isch`.
- Diphthongs are written as you hear them: `guet`, `Muetter`, `Brüeder`, `lieb`, `föif`, `neu`.
- `ch` for the guttural /x/, also at the start of a word: `Chind`, `cho`, `Chuchi`. Use `sch` for
  /ʃ/ before t and p: `Schwöschter`, `bisch`, `geschter`.
- Elided articles are written without an apostrophe: `de Reto`, `d Sandra`, `s Chind`, `z Züri`.
- Use no ß, ever.
- **Alternatives:** separate common spellings with ` / ` in vocabulary (`Wie gaats? / Wie gahts?`),
  and list each as a separate accepted answer in exercises. The first form is the most widely used
  Zurich spelling. The grader also applies a lenient fold for vowel length and ä/e, but listing the
  real variants is still required.
- **Never invent forms.** If you are not sure how something is said in Zurich, use the most widely
  used form, add it to the unit's review list in your PR, and ask a native reviewer.
- Bernese goes in `gswBe` (vocabulary) or `variety: gsw-be`. Add it only where it is clearly
  different (`i`, `är`, `nid`, `mir hei`, `Grüessech`, `chaut`, `viu`).

## 4. unit.yaml

```yaml
id: a1-u01
level: A1
review:                            # native sign-off: leave de / ch / date empty until a human has checked
  notes:                           # open questions for the reviewer (every form you were unsure of)
    - "Is 'Wämmer grad Duzis mache?' natural Zurich German?"
number: 1
title: Grüezi und Hallo!          # German title
titleEn: Hello and hi!
goal: >-
  By the end you can greet people, introduce yourself ...
canDo:                             # 3–6 CEFR-style "I can ..." statements
  - I can greet people and say goodbye, formally and informally.
intro:
  scene: First morning of a German course in Zurich ...
  dialogue:                        # 8–12 lines, each with an English translation
    - { speaker: Frau Keller, text: "Guten Morgen! Wie heißen Sie?", en: "Good morning! What's your name?" }
grammar:                           # 2–4 points
  - id: sein-present               # referenced by exercises' `grammar` lists
    title: "sein (to be) and the personal pronouns"
    body: >-                       # Markdown, English, with German examples in *italics* / **bold**
      **sein** is irregular ...
    tables:                        # first row = header
      - [["Pronoun", "sein"], ["ich", "bin"], ["du", "bist"]]
    commonMistakes:                # typical errors of English speakers: *wrong* → **right** + why
      - "*Ich bin ein Lehrer.* → **Ich bin Lehrer.** No article before a job."
reading:                           # optional; 80–150 words at A1
  title: Hallo aus dem Deutschkurs!
  text: >-
    Hallo! Ich heiße Mia ...
  en: >-
    Hi! My name is Mia ...
swiss:                             # the Swiss lane – required in every unit
  scene: In the stairwell of an apartment building in Zurich ...
  dialogue:                        # 6–10 lines, the same situation in dialect
    - { speaker: Reto, text: "Grüezi! Sind Sie neu da?", en: "Hello! Are you new here?", variety: gsw-zh }
  notes:                           # 3–6 notes: differences from Standard German, Helvetisms, culture
    - "**Grüezi** is the polite greeting to one person ..."
```

Grammar ids are shared across the whole course. Reuse an earlier id when an exercise revises an
earlier point. The linter warns about ids that are not defined anywhere.

## 5. vocab.yaml

```yaml
- id: kaffee
  de: Kaffee                      # without the article; gender is a field
  en: coffee
  pos: noun                       # noun verb adj adv prep conj pron num phrase other
  gender: m                       # required for nouns (m / f / n)
  plural: Kaffees                 # required for nouns; "-" when there is no plural (Milch, Schweiz)
  example: { de: "Ich möchte einen Kaffee, bitte.", en: "I'd like a coffee, please." }
  gswZh: Kafi (en Kafi; en Kafi Crème = coffee with cream)
  gswBe: Kafi                     # only if notably different from Zurich
  # audio fields: audio (word), example.audio, gswZhAudio, gswBeAudio; leave them out until the
  # file exists, npm run audio:link writes them (see AUDIO.md)
  tags: [cafe, drinks]

- id: eltern
  de: Eltern                      # plural-only noun: de is the plural form
  en: parents
  pos: noun
  pluralOnly: true                # no gender, no plural field
  gswZh: Eltere
  tags: [family]
```

- Use 30–40 items per unit. Each noun has a gender and a plural. Give an example sentence that only
  uses vocabulary from this unit and earlier units.
- `chStd` is for a real Helvetism only (Gipfeli, Velo, Glace, Morgenessen, Götti, `gross`, `heissen`).
  Leave it out when Swiss Standard German is the same.
- `gswZh` is for the Zurich form. Leave it out when it is identical *and* obvious. Add short grammar
  hints in brackets (`cho (ich chume, du chunnsch)`).

## 6. exercises.yaml

Every exercise has these common fields:

| Field         | Required | Notes |
|---------------|----------|-------|
| `id`          | yes      | `a1-u02-gap-accusative` |
| `type`        | yes      | one of the ten types below |
| `skill`       | yes      | `reading`, `listening`, `speaking`, `writing`, `vocabulary`, `grammar` |
| `variety`     | yes*     | defaults to `de`; always write it out anyway |
| `prompt`      | yes      | English instruction |
| `explanation` | yes      | English; **teaches the rule** (see section 7) |
| `grammar`     | no       | grammar point ids the item practises (feeds the error profile) |
| `audio`       | no       | leave it out until the file exists |

Examples of each type:

```yaml
- id: a1-u01-mcq-sein-du
  type: mcq
  skill: grammar
  variety: de
  grammar: [sein-present]
  prompt: Choose the correct form of sein.
  question: Du ___ Tom, oder?
  options: ["bist", "bin", "ist", "seid"]
  answer: 0                        # index into options
  rationales: ["Correct. du bist.", "bin goes with ich.", "ist goes with er/sie/es.", "seid goes with ihr."]
  explanation: >-
    sein is irregular: ich bin, du bist, er/sie/es ist, wir sind, ihr seid, sie/Sie sind.

- id: a1-u02-gap-accusative
  type: gap
  skill: grammar
  variety: de
  grammar: [accusative-indefinite]
  prompt: Fill in ein, eine or einen.
  text: Ich möchte ___ Kaffee, ___ Schokolade und ___ Wasser.   # exactly three underscores per gap
  answers: [["einen"], ["eine"], ["ein"]]                         # one list per gap; first = model
  explanation: >-
    After möchte the noun is a direct object (accusative). Only the masculine changes: einen Kaffee.

- id: a1-u01-order-statement
  type: order
  skill: grammar
  tokens: ["aus", "komme", "Ich", "England"]          # shown shuffled; no final punctuation
  answers: ["Ich komme aus England.", "Aus England komme ich."]   # every correct order
  prompt: Put the words in order.
  explanation: The conjugated verb is in position 2 ...

- id: a1-u01-match-greetings
  type: match
  skill: vocabulary
  prompt: Match the German phrases with their English meaning.
  pairs: [["Freut mich!", "Nice to meet you!"], ["Entschuldigung!", "Excuse me!"]]  # both sides unique
  explanation: ...

- id: a1-u01-dictation-anna
  type: dictation
  skill: listening
  prompt: Listen and write what you hear.
  transcript: Guten Tag! Ich heiße Anna.        # spoken via TTS until audio exists
  explanation: ...

- id: a1-u01-translate-wo
  type: translate
  skill: writing
  prompt: Translate into German (informal).
  source: Where do you live?
  answers: ["Wo wohnst du?"]                    # all accepted translations; unknown ones may go to AI
  explanation: ...

- id: a1-u01-ch-transform-vo-wo
  type: transform
  skill: reading
  variety: gsw-zh
  prompt: What does this mean in Standard German?
  from: gsw-zh                                  # also de → de (du → Sie) and de → gsw-zh (recognition)
  to: de
  source: Vo wo chunnsch du?
  answers: ["Woher kommst du?"]
  explanation: ...

- id: a1-u01-speak-intro
  type: speak
  skill: speaking
  prompt: Read aloud, then say it with your own details.
  target: Guten Morgen! Ich heiße Tom.
  explanation: ...

- id: a1-u01-write-profile
  type: write
  skill: writing
  prompt: Write a short profile for the course notice board.
  task: Write 4–6 sentences about yourself ...
  minWords: 30
  model: Hallo! Ich heiße Sarah Miller ...
  checklist: ["I use heißen with my name.", "The verb is in position 2 in every statement."]
  explanation: ...

- id: a1-u01-roleplay-reto
  type: roleplay
  skill: listening
  variety: gsw-zh
  tutor: reto                                  # lena (friendly, Standard), keller (formal), reto (Zurich), explainer
  prompt: "Listening roleplay with Reto"
  scenario: Reto, your new neighbour, greets you in Zurich German ...
  goals: ["Understand 'Wie heissisch?' and say your name."]
  model: |
    Reto: Grüezi! Sind Sie neu da?
    Du: Guten Tag! Ja, ich wohne jetzt hier.
  explanation: ...
```

### Unit mix

- Write 30–45 exercises per unit, covering **all six skills** and **at least eight types**.
- Each unit has **at least 5 Swiss-lane exercises** (`variety: gsw-zh`). The linter requires at least one.
- **A1–A2:** Swiss items are about comprehension and recognition: gsw→de transforms, listening MCQs,
  matching, and recognition-level de→gsw transforms with many accepted spellings. Do not ask
  learners to produce free dialect before B1.
- **Bernese at A1–A2:** 2–4 recognition items per unit (`variety: gsw-be`: gsw-be → de transforms,
  listening MCQs, matching) and, where it fits, a few `gsw-be` dialogue lines. Use only forms you can
  source (for example berndeutsch.ch) and record the source in `docs/NATIVE_REVIEW.md`.
- **B1+:** Add dialect `speak` items, `gsw-zh` roleplays where the learner answers in dialect, and
  `gsw-be` items where the curriculum says so.
- In every unit, include one Lena roleplay (Standard, speaking) and one Reto roleplay (Swiss lane,
  listening-oriented at A1–A2).
- For listening MCQs on the dialogues (no audio yet), refer to the dialogue in the prompt ("Listen to
  the intro dialogue again").
- **Speaking (from v0.3, units 7+):** at least **5 `speak` items** per unit: a read-aloud frame the
  learner then personalises, **shadowing** of 1–2 dialogue lines (prompt starts with "Shadowing:";
  the `target` is the exact dialogue line, with the line's variety), an intonation item, and a
  pronunciation item that applies a drill to the unit's words. Name the drill in the explanation
  ("See the drill ü vs u and i") so the app can link to it. At A1–A2 `speak` items are `de` or
  `ch-std`, never `gsw-*`.
- **Swiss Standard lines in dialogues:** a speaker who is Swiss but speaks Standard German (a
  passer-by, a receptionist) gets `variety: ch-std` and Swiss spelling (`ss`, Billett, Tram).
- **Vary the position of the correct MCQ option** (the linter warns when every answer is 0); aim for
  a roughly even spread over the unit.

## 7. Style rules

1. **Explanations teach the rule.** "The correct answer is *einen*" is not enough. Write: "der Tee is
   masculine and the object of nehmen, so it takes the accusative: einen Tee." Name the pattern, give
   the contrast, and point out the trap for English speakers. Use 1–3 sentences.
2. **List every acceptable answer.** The first answer is the model answer. Add the ss variant, `gern`
   and `gerne`, alternative word orders that are correct, and contractions where natural. The linter
   runs the grader on the model answer.
3. **Gaps are exactly `___`** (three underscores), with one answer list per gap.
4. **Stay within the level's vocabulary.** A sentence may use only words from this unit and earlier
   ones, plus transparent internationalisms (Hotel, Baby, Café). If you need a new word, gloss it in
   the prompt (`(fragen = to ask)`). Guide sizes (cumulative, productive): A1 ≈ 600–800 words,
   A2 ≈ 1,300, B1 ≈ 2,500, B2 ≈ 4,000, C1 ≈ 6,000+, C2 open. Per unit: 30–40 new items at A1–A2,
   40–60 at B1–B2, and around 60 at C1–C2.
5. **Grammar only at or below the level.** Check `docs/CURRICULUM.md`. If a structure from a later
   unit is unavoidable, treat it as a chunk (`Ich hätte gern`, `keine Geschwister`) and do not test it.
6. **Natural German.** Write what people say: "Ich hätte gern ein Stück Kuchen", not "einen Kuchen"
   for a slice. Swiss settings use francs, Swiss place names and Helvetisms, and Swiss texts written
   as ch-std use ss.
7. **Inclusive and varied.** Use mixed names and origins, all kinds of families, and everyday adult
   situations. Avoid stereotypes in the Swiss lane: humour is welcome, mockery of a region is not.
8. **Original material only.** Never copy, adapt or paraphrase items, texts, dialogues or audio
   scripts from exam publishers or textbooks (Goethe-Institut, telc, ÖSD, TestDaF, Cambridge,
   publishers' course books, and so on). Write your own items in the *format* of a task type
   (for example a telc-style matching task) and with your own content. The same applies to song
   lyrics and literature: quote only short public-domain or licensed excerpts, and record the source.
9. **Markdown** is allowed in `body`, `notes` and `commonMistakes` (`*wrong*`, `**right**`). Keep
   other fields plain text.
10. **YAML hygiene.** Quote strings that contain `: `, ` #`, or that start with a quote, `*`, `&`, `!`,
    `[`, `{` or `@`. Use `>-` for long English text and `|` for roleplay models (one line per turn,
    `Name: text`).

## 8. Lexicon (content/lexicon/gsw-zh.yaml)

```yaml
entries:
  - { de: gehen, gswZh: "gaa / gah (ich gang, du gaasch, er gaat, mir gönd)", gswBe: "ga (i gange, du geisch)", en: to go, pos: verb, notes: "...", tags: [verbs] }
```

The lexicon has one entry per Standard German headword. It has `de`, `gswZh` and `en` (all
required), plus optional `gswBe`, `chStd`, `pos`, `notes` and `tags`. Tag false friends
(`laufe` = walk, `springe` = run, `lose` = listen) with `false-friend`. Each new unit's Swiss lane
should reuse lexicon spellings, so the course stays consistent.

`npm run content:lint` validates every `content/lexicon/*.yaml` with a light schema
(`tools/src/lexicon.ts`): YAML syntax, the fields above (no unknown keys, no empty strings, `pos`
one of noun, verb, adj, adv, prep, conj, pron, num, phrase, other) and no duplicate headword
(same `de` and `pos`). The lexicon is reference data, not part of the content contract, so its schema
lives in `tools/` rather than `packages/content-schema`.

## 9. Pronunciation drills (content/pronunciation/<id>.yaml)

One `PronunciationDrill` per file; the file name is the id (`ue-u-i.yaml` has `id: ue-u-i`).

```yaml
id: ue-u-i
title: ü vs u and i
ipa: [y, u, i]
level: A1            # default A1
variety: de          # de, ch-std, gsw-zh or gsw-be; default de
explanation: >-
  Say **ee** and round your lips as if for *oo*.
tips: ["Keep the tongue forward."]
pairs:               # minimal pairs [a, b]; the two words must differ
  - [{ text: Mütter, en: mothers }, { text: Mutter, en: mother }]
words:               # at least one
  - { text: fünf, en: five }
sentences:
  - { text: Die Tür ist grün., en: The door is green. }
commonMistakes: ["*Mutter* for *Mütter*: the lips are not rounded."]
```

Every pair word, word and sentence can take an `audio:` path relative to
`content/pronunciation/<id>/` (for example `audio/pron-ue-u-i-pair-01-a.mp3`); `npm run audio:link`
fills it. `npm run content:lint` checks: schema, file name = id, unique ids, the two words of a pair
differ, no empty `text`/`en`, repeated pairs/words (warning), unknown fields (warning), missing audio
files (warning), and that the speaking grader accepts each text read back verbatim. `content:build`
compiles all drills into `apps/web/public/packs/pronunciation.json` (`PronunciationPack`, an empty
pack when there are none). Drill attempts are stored with unit id `pron-<id>`.

### Writing drills

- **One sound or contrast per drill.** The syllabus and the list of planned drills are in
  `docs/PRONUNCIATION.md`; check it before adding a drill, and add the new id there.
- **`explanation`** (Markdown, English): how to make the sound, starting from the nearest English
  sound and saying exactly what changes (tongue, lips, voice, length); the spelling rules that go
  with it; and the trap for English speakers. Mention Swiss Standard or regional variants that are
  also correct, so the learner isn't marked down for them.
- **`ipa`**: the symbols involved, without slashes or brackets (`["yː", "ʏ"]`).
- **`tips`**: 3–4 short, physical tips (mirror, hand in front of the mouth, start from an English
  word).
- **`pairs`**: 6–10 minimal pairs where the language has them; the wrong sound must give a different
  word. Glosses are short; mark stress in the gloss when stress is the point (`to get up
  (AUF-stehen)`), never with capitals in `text` (the TTS and the grader read `text`). Near pairs are
  fine where true pairs don't exist (Swiss k-sounds, glottal stop) – say so in the explanation. Give
  at least one pair: the listening quiz needs it.
- **`words`**: 10–15, mostly from the A1 vocabulary. **`sentences`**: 3–5 short, natural sentences
  that use the sound several times. Quote every `text` and every `en` that contains `,` `?` `:` `!`
  or `'` in flow mappings.
- **`commonMistakes`**: 3–4, in the form `*wrong* for *right*: what went wrong`.
- **Variety:** a `de` drill contains no Helvetisms and no dialect; a `ch-std` drill uses Swiss
  spelling; a `gsw-zh` drill is a **listening and imitation** drill until B1 (say so in the first
  sentence), uses lexicon spellings, and puts the Standard German word in the gloss
  (`en: child (Kind)`) rather than in `text`.
- **Level:** `A1` for sounds that change words; `A2` for fluency features and accents to recognise.

## 10. Review

Content ships as *draft* until it has passed native review (see `docs/ROADMAP.md`): two German
reviewers per level, and one Zurich reviewer for every `gsw-zh` line. In the PR description,
authors list every form they were unsure of.
