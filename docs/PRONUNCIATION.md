# Pronunciation syllabus A1–C2

Doppelpunkt teaches pronunciation in two places:

1. **Pronunciation drills** (`content/pronunciation/<id>.yaml`, one `PronunciationDrill` each, format in
   [CONTENT_FORMAT.md §9](CONTENT_FORMAT.md)). A drill trains one sound or contrast: explanation compared
   with English mouth positions, IPA, tips, minimal pairs (listen and choose, then repeat), words,
   sentences and typical mistakes of English speakers. Drills are independent of units and can be
   opened at any time from the Pronunciation screen.
2. **`speak` items in the units**. Every unit has at least five: read-aloud frames, **shadowing** of
   dialogue lines (speak along with the recording, then alone), intonation items, and one or two items
   that apply a drill to the unit's words. These explanations name the drill ("see the drill ü vs u
   and i") so the app can link to it.

The target model is **Standard German as spoken in Germany**, with the **Swiss Standard German** accent
taught as an equally correct variety to recognise (and to copy, if the learner lives in Switzerland).
Swiss German drills are **listening and imitation** drills until B1: they help learners hear the
dialect, and active dialect speaking only starts at B1 (see [CURRICULUM.md](CURRICULUM.md)).

## Principles

- **Contrast first.** English speakers mostly fail by substituting an English sound. Each drill starts
  from the nearest English sound and says what to change (tongue, lips, voice, length).
- **Minimal pairs carry meaning.** Pairs are chosen so that the wrong sound gives a different word
  (*Mutter / Mütter*, *Nacht / nackt*, *kennen / können*). Where a language has no true minimal pairs
  (Swiss k-sounds, glottal stop) the drill uses near pairs and says so.
- **A1 vocabulary.** Words and sentences use the course's A1 vocabulary wherever possible, so drills
  double as vocabulary revision. Rare words appear only in pairs, with a gloss.
- **Spelling rules are taught with the sound** (*ie* is long, *ck* makes the vowel short, *st* at the
  start is *scht*), because learners read far more than they listen.
- **Accents are not errors.** The grader accepts a rolled or tapped r, *-ig* as *-ik*, and Swiss
  Standard features. Feedback targets only substitutions that change words or block understanding.
- **No invented dialect.** Swiss drills use forms that are in the lexicon or sourced in
  [NATIVE_REVIEW.md](NATIVE_REVIEW.md); everything else is flagged for the Zurich reviewer.

## Drills by level

Status: ✅ written (v0.3) · 🗓️ planned (version in brackets).

### A1 – the sounds that change words

| Drill id | Title | Variety | Status | First needed in |
|---|---|---|---|---|
| `ue-u-i` | ü vs u and i | de | ✅ | A1.2 (*fünf, für*), A1.6 (*Küche, Tür*) |
| `oe-o-e` | ö vs o and e | de | ✅ | A1.2 (*möchte*), A1.3 (*Söhne, Töchter*) |
| `vowel-length` | Long and short vowels | de | ✅ | A1.2 (*Tee, Kaffee*), A1.6 (*Miete*) |
| `ich-laut` | The ich-Laut (soft ch) | de | ✅ | A1.1 (*ich*), A1.2 (*Milch, möchte*) |
| `ach-laut` | The ach-Laut (back ch) | de | ✅ | A1.2 (*acht, Kuchen*), A1.3 (*Tochter*) |
| `r-and-er` | German r and the vocalised -er | de | ✅ | A1.3 (*Mutter, Vater, Bruder*) |
| `final-devoicing` | Final devoicing (Auslautverhärtung) | de | ✅ | A1.4 (*Tag, Abend, halb*) |
| `w-v-f` | w, v and f | de | ✅ | A1.1 (*wie, wo, woher*), A1.7 (*Winter, Klavier*) |
| `z-pf` | z [ts] and pf | de | ✅ | A1.1 (*Zürich*), A1.2 (*zwei, zehn*), A1.8 (*Zug*) |
| `s-sch-st-sp` | s, sch, st and sp | de | ✅ | A1.4 (*aufstehen, Stunde*), A1.8 (*Straße, Bahnsteig*) |
| `ei-ie-eu` | ei vs ie, and eu/äu | de | ✅ | A1.1 (*heißen, wie*), A1.2 (*neun / nein*) |
| `word-stress` | Word stress in compounds and verbs | de | ✅ | A1.4 (separable verbs), A1.8 (compounds), A1.9 (*anrufen / verschieben*) |
| `gsw-ch-gg-kch` | Swiss German ch, gg and kch | gsw-zh | ✅ | A1.1 (*Chuchichäschtli*), A1.2 (*Chäs, Schoggi*), A1.6 (*Chuchi*) |
| `gsw-vowels` | Swiss German long vowels and ie, ue, üe | gsw-zh | ✅ | A1.2 (*drü, nüün, zää*), A1.3 (*Muetter, Brueder*) |
| `j-h` | j [j] and h (aspirated, silent h) | de | 🗓️ (0.4) | A1.9 (*Januar, Juni, Juli*) – the grader already reports the `j` issue |
| `intonation-questions` | Questions, statements, lists | de | 🗓️ (0.4) | A1.7 (yes/no questions rise) – currently taught in `speak` items |

### A2 – fluency and the Swiss Standard accent

| Drill id | Title | Variety | Status |
|---|---|---|---|
| `glottal-stop` | The glottal stop (Knacklaut) | de | ✅ |
| `ch-std-accent` | The Swiss Standard German accent | ch-std | ✅ |
| `ae-e` | ä vs e (*Ähre / Ehre*, *Bären / Beeren*), and open ä in Switzerland | de | 🗓️ (1.0) |
| `ng-nk` | ng vs nk vs n+g (*singen / sinken*, *Angel / an-gehen*) | de | 🗓️ (1.0) |
| `schwa-en` | Unstressed -e, -en, -el (*haben* → *habm*, *Tisch-e*) | de | 🗓️ (1.0) |
| `gsw-diminutive-li` | Swiss -li and the light final -i (*Hüsli, Chätzli, Müesli*) | gsw-zh | 🗓️ (1.0, with A2.5) |
| `gsw-be-l-vocalisation` | Bernese l → u and nd → ng (*Miuch, aues, Ching*), recognition | gsw-be | 🗓️ (1.0) |

### B1 – connected speech; active Swiss German begins

| Drill id | Title | Variety | Status |
|---|---|---|---|
| `connected-speech` | Reduced forms: *hast du → haste, gibt es → gibt's, einen → 'nen* | de | 🗓️ (1.3) |
| `sentence-stress` | Focus and contrastive stress (*ICH komme, nicht er*) | de | 🗓️ (1.3) |
| `gsw-r-tap` | The Swiss tapped r and the unvocalised -er | gsw-zh | 🗓️ (1.3) |
| `gsw-fortis-lenis` | Swiss fortis/lenis without devoicing (*bis / Biss*), unaspirated p t k | gsw-zh | 🗓️ (1.3) |
| `gsw-ae-e` | Zurich *ä* vs *è* vs *e* (*läse, Mänsch, erchläre*) | gsw-zh | 🗓️ (1.3) |
| `gsw-melody` | Zurich sentence melody and the tag *oder?* | gsw-zh | 🗓️ (1.3) |
| `gsw-be-vowels` | Bernese short *y / ü / u* (*Zyt, Lüt, lut*), production | gsw-be | 🗓️ (1.3) |

### B2 – natural prosody and regional Standard accents

| Drill id | Title | Variety | Status |
|---|---|---|---|
| `intonation-attitude` | Politeness, surprise, irony through intonation | de | 🗓️ (1.4) |
| `regional-standard` | Recognising Austrian and southern German Standard accents | de | 🗓️ (1.4) |
| `fast-speech` | Listening to fast speech: elision and assimilation | de | 🗓️ (1.4) |
| `gsw-switching` | Switching between dialect and Swiss Standard (diglossia) | ch-std / gsw-zh | 🗓️ (1.4) |

### C1–C2 – other dialects, performance, play

| Drill id | Title | Variety | Status |
|---|---|---|---|
| `gsw-regional` | Basel (*Kind, Kuchi* with k), Lucerne, St. Gallen, Valais: listening | gsw-* | 🗓️ (2.0) |
| `presentation-prosody` | Pausing, pace and emphasis in talks | de | 🗓️ (2.0) |
| `verse-rhythm` | Rhythm in poems and songs (public-domain texts only) | de / gsw-zh | 🗓️ (2.0) |
| `wordplay-sounds` | Puns and sound jokes (*Blumentopferde*, *Urinstinkt*) | de | 🗓️ (2.0) |

## How drills relate to units

Every unit's explanations and `speak` items point to the drills that matter for its words. A1 units
7–9 (v0.3) are the first written with this in mind: their pronunciation `speak` items name the drill.
Units 1–6 predate the drills; their pronunciation items will get the same pointers in v0.4.

| Unit | Drills that matter for the unit's words |
|---|---|
| A1.1 Grüezi und Hallo! | `ei-ie-eu`, `w-v-f`, `z-pf`, `gsw-ch-gg-kch` (listening) |
| A1.2 Im Café | `ue-u-i`, `z-pf`, `ich-laut`, `ach-laut`, `vowel-length`, `gsw-vowels` (Zurich numbers) |
| A1.3 Meine Familie | `oe-o-e`, `ach-laut` / `ich-laut` (*Tochter / Töchter*), `r-and-er`, `gsw-vowels` (*Muetter*) |
| A1.4 Mein Tag | `word-stress` (separable verbs), `final-devoicing`, `s-sch-st-sp` |
| A1.5 Einkaufen | `vowel-length`, `ei-ie-eu`, `gsw-ch-gg-kch` (*Chäs, Schoggi*) |
| A1.6 Wohnen in der Schweiz | `ue-u-i`, `ich-laut` (*Küche, gemütlich*), `gsw-ch-gg-kch` (*Chuchi*) |
| A1.7 Freizeit und Hobbys | `ue-u-i` (*Frühling*), `ich-laut` / `ach-laut` (*mache, Woche*), `w-v-f`, `r-and-er`; question intonation |
| A1.8 Unterwegs in der Stadt | `z-pf` (*Zug, Zürich*), `s-sch-st-sp` (*Straße, Bahnsteig*), `word-stress` (*Bahnhof*), `ch-std-accent` (shadowing a Swiss passer-by) |
| A1.9 Termine und Verabredungen | `word-stress` (*anrufen* vs *verschieben*), `ch-std-accent` (shadowing the receptionist), `glottal-stop` (Swiss linking: *am elften*) |
| A1.10–A1.12 | `oe-o-e` (*Größe*), `ach-laut` (*Bauch*), `z-pf` (*Kopf*), `gsw-ch-gg-kch` (*Chopfweh*), review of all A1 drills |

### Speech-grader hints → drills

The speaking grader (`packages/engine/src/speech.ts`) reports a pronunciation issue id when a word
differs only by a typical English-speaker substitution. The app should offer the matching drill:

| Issue id | Drill |
|---|---|
| `ue` | `ue-u-i` |
| `oe` | `oe-o-e` |
| `ae` | `vowel-length` until `ae-e` exists |
| `ch` | `ich-laut` (after front vowels and consonants) or `ach-laut` (after a, o, u, au); `gsw-ch-gg-kch` for `gsw-*` items |
| `er` | `r-and-er` |
| `w-v` | `w-v-f` |
| `z` | `z-pf` |
| `ei-ie` | `ei-ie-eu` |
| `length` | `vowel-length` (`gsw-vowels` for `gsw-*` items) |
| `j` | `j-h` (planned; until then no drill) |

## Order inside a drill (app flow)

1. Read the explanation (and look at the IPA if wanted).
2. **Listen** to the minimal pairs and pick which word you heard (listening quiz; needs ≥ 1 pair).
3. **Repeat** pairs, then words, then sentences; the speaking grader compares the transcript with the
   text and gives half credit plus a hint for typical substitutions.
4. Common mistakes are shown as feedback when the grader detects the matching issue, and at the end.

## Recording notes

Drill recordings follow [AUDIO.md](AUDIO.md). Both words of a minimal pair are read by the same voice
with the same intonation, so only the sound differs. `gsw-zh` drills need a Zurich speaker,
`ch-std-accent` a Swiss speaker reading Standard German, and every other drill a speaker from Germany
with a neutral accent (uvular r, ich-Laut, vocalised -er).
