# Audio: recording guide and pipeline

This guide is for voice actors, the audio producer and content authors. It covers what to record,
how to record it, how to name and deliver files, and how the recordings get into the app.

Until a file exists the app falls back to text-to-speech for Standard German. The Swiss lane has no
usable TTS, so Swiss recordings matter most.

## 1. Pipeline at a glance

```
unit YAML ──audio:scripts──▶ audio-script.md + audio-manifest.json   (what to record)
                                   │
                   studio session  ▼
raw/<level>/unit-NN/*.wav ──audio:process──▶ content/<level>/unit-NN/audio/*.mp3 + *.opus
                                                   │
                                   audio:link      ▼
                     writes `audio:` fields into unit.yaml / vocab.yaml / exercises.yaml
                                                   │
                                   content:build   ▼
               apps/web/public/packs/audio/<level>/<unitId>/audio/*.{mp3,opus}
```

| Command | What it does | Needs ffmpeg |
| --- | --- | --- |
| `npm run audio:scripts` | Writes `audio-script.md` and `audio-manifest.json` into every unit folder. `-- --check` exits 1 if they are out of date. | no |
| `npm run audio:process -- --in <folder> [--unit a1/unit-01] [--force]` | Trims silence, normalises loudness, encodes mp3 + opus into the unit's `audio/` folder. Skips (exit 0) when ffmpeg is missing. | yes |
| `npm run audio:link [-- --dry-run \| --force]` | Writes the `audio:` field for every manifest entry whose processed file exists. Keeps comments and formatting. | no |
| `npm run content:lint` | Warns about `audio:` fields pointing to missing files; prints `audio coverage: X/Y`. | no |
| `npm run content:report` | Per-unit table including audio coverage. | no |
| `npm run content:build` | Copies referenced audio (and the `.opus` sibling) next to the packs. | no |

ffmpeg is optional for the repository: lint, tests and build never need it. Set `FFMPEG=/path/to/ffmpeg`
if it is not on your `PATH`.

## 2. The manifest

`npm run audio:scripts` derives the recording list from the YAML. Run it again whenever a unit
changes; the output is deterministic, so an unchanged unit produces an unchanged file.

What gets an entry:

| Kind | File name | Text | YAML field filled by `audio:link` |
| --- | --- | --- | --- |
| Intro dialogue line | `dialog-intro-NN.mp3` (NN = line number, from 01) | `text` | `intro.dialogue[i].audio` |
| Swiss lane dialogue line | `dialog-swiss-NN.mp3` | `text` | `swiss.dialogue[i].audio` |
| Vocabulary word | `vocab-<id>.mp3` | `de` | `vocab[i].audio` |
| Vocabulary example | `vocab-<id>-ex.mp3` | `example.de` | `vocab[i].example.audio` |
| Zurich German word | `vocab-<id>-zh.mp3` | `gswZh` | `vocab[i].gswZhAudio` |
| Bernese German word | `vocab-<id>-be.mp3` | `gswBe` | `vocab[i].gswBeAudio` |
| Dictation | `ex-<exercise id>.mp3` | `transcript` | `exercises[i].audio` |
| Speaking model | `ex-<exercise id>.mp3` | `target` | `exercises[i].audio` |
| Listening stimulus | `ex-<exercise id>.mp3` | the quoted text in the prompt | `exercises[i].audio` |

Listening items whose prompt says "Listen to the intro dialogue" reuse the dialogue recordings and get
no entry of their own. Roleplays are generated live and are not recorded.

Each manifest entry has: `file`, `path` (the value for the YAML field), `kind`, `text`, `note`
(parenthesised reading hints such as "(to a group)" moved out of the text), `en`, `variety`, `voice`,
`speaker`, `voiceGuessed` (speaker not in the cast list), `source` (YAML file, id and pointer to the
field `audio:link` fills), `referenced` (the YAML already points at `path`) and `current`
(the YAML points somewhere else).

Dialogue numbering follows the line order. If a writer inserts a line in the middle of a recorded
dialogue, the following lines get new numbers: re-record or rename those files and run `audio:link`
again. `audio:link` never overwrites a hand-set path to an existing file unless you pass `--force`.

Audio coverage (lint, report, build) counts every manifest entry: recorded = its YAML field is set and
the file exists.

## 3. Voices

Six voice slots. A1 needs the first four.

| Voice | Who | Reads |
| --- | --- | --- |
| `de-f` | Female native speaker of German Standard German (Germany, neutral accent) | Anna, Frau Keller, the Kellnerin when she speaks Standard German, alternate vocab items |
| `de-m` | Male native speaker of German Standard German | Tom, alternate vocab items, examples |
| `zh-f` | Female Zurich German native speaker | Sandra, Swiss lane waitress, Zurich vocab forms, Swiss Standard German (`ch-std`) items |
| `zh-m` | Male Zurich German native speaker | Reto, Zurich vocab forms, Swiss Standard German items |
| `be-f` | Female Bernese German native speaker | `gsw-be` items and Bernese vocab forms (optional for A1) |
| `be-m` | Male Bernese German native speaker | `gsw-be` items and Bernese vocab forms |

- Swiss Standard German (`ch-std`) is read by the Zurich voices: the Swiss accent is part of the variety.
- The cast list lives in `tools/src/audio.ts` (`CAST`). Add new characters there; until then the
  script marks their voice with `(?)` and alternates female/male.
- Vocabulary alternates voices word by word; the example sentence uses the other voice so learners hear
  both.
- Zurich voices speak dialect as they naturally would at a slow, clear pace. The text uses Dieth-style
  spelling and is a guide, not a straitjacket: if a speaker would naturally say it differently, flag it
  to the Swiss reviewer rather than reading something unnatural.

## 4. Recording

**Equipment.** Large-diaphragm condenser or a good dynamic broadcast microphone, pop filter,
audio interface with clean preamps, closed headphones. No laptop or phone microphones, no USB
headsets.

**Room.** Small, soft, quiet: a treated booth or a room with curtains, carpet and soft furnishing.
No audible echo when you clap. Switch off fans, fridges and notifications. Noise floor below -60 dBFS.

**Settings.** 48 kHz, 24-bit, mono. Peaks around -12 to -6 dBFS; never clip. No processing in the
recording chain (no compression, noise gate, EQ or de-esser); the pipeline does loudness.

**Mic technique.** 15–20 cm from the mouth, slightly off-axis. Keep distance and level constant
through a session so lines match.

**Performance.**
- Natural, friendly, slightly slower than conversational speed (A1: about 80% of normal pace). Do not
  over-articulate or chop words apart.
- Dialogues: play the character, react to the previous line. Record each line as its own take.
- Vocabulary: read the word once with natural intonation (an exclamation stays an exclamation). For
  alternatives separated by " / ", read each one with a one-second pause. Do not read the article
  unless it is written. Notes after "note:" are instructions, not text.
- Dictation: clear, even pace, normal sentence melody; do not pause between words.
- Leave about half a second of silence before and after each take. The pipeline trims the rest.
- Mistake? Pause, then repeat the whole line. Deliver only the good take.

## 5. Naming and delivery

- One file per manifest entry, named after the `File` column of `audio-script.md` with the
  extension changed: `dialog-intro-03.wav`, `vocab-guten-morgen.wav`, `ex-a1-u01-dictation-anna.wav`.
- Put files in one folder per unit: `raw/a1/unit-01/…`. Names like `dialog-intro-01` exist in every
  unit, so a flat folder only works for unique names or together with `--unit`.
- Format: WAV or FLAC, 48 kHz, 24-bit, mono. (mp3, m4a, ogg, opus and webm are accepted for
  quick tests but lose quality.)
- Lower-case names exactly as listed; no spaces, takes or initials in the name.
- Include a short `notes.txt` per unit with anything the reviewer should hear (changed wording, an
  alternative pronunciation).
- Raw files stay out of git. Deliver them to the producer (shared drive); only processed files are
  committed under `content/<level>/unit-NN/audio/`.

## 6. Processing (producer)

```
npm run audio:scripts                       # refresh the manifests
npm run audio:process -- --in ~/raw         # raw/a1/unit-01/*.wav, raw/a1/unit-02/*.wav, ...
npm run audio:process -- --in ~/raw/u3 --unit a1/unit-03   # a flat folder for one unit
npm run audio:link                          # write the audio: fields
npm run content:lint && npm run content:report
```

`audio:process` does, per file, with ffmpeg:

1. High-pass at 70 Hz (rumble), downmix to mono.
2. Trim leading silence (keeps 150 ms) and trailing silence (keeps 250 ms), threshold -50 dB.
3. Two-pass EBU R128 loudness normalisation to **-16 LUFS integrated, -1.5 dBTP true peak, LRA 11**
   (linear gain when possible).
4. Encode `<name>.mp3` (MP3, 64 kbps CBR, mono, 44.1 kHz) and `<name>.opus` (Opus, 32 kbps, mono,
   48 kHz), bit-exact and without metadata so re-runs give identical files.

Files whose outputs are newer than the input are skipped; `--force` re-encodes. Files that are not
in any manifest, or are ambiguous, are reported and skipped. The YAML references the `.mp3`; the
build copies the `.opus` sibling next to it so the app can prefer Opus where supported.

## 7. Quality check and sign-off

- Listen to every processed file once, at normal volume, on headphones: no clicks, breaths at the
  edges, clipping, room noise or cut-off words.
- The Standard German reviewer (`review.de`) checks the `de` recordings; the Swiss reviewer
  (`review.ch`) checks Zurich and Bernese recordings and every `ch-std` item. See `NATIVE_REVIEW.md`.
- A unit's audio is done when `npm run content:report` shows full coverage for it and both reviewers
  have listened.
- Ship: `npm run content:build` copies the files into `apps/web/public/packs/audio/`. CDN upload is a
  later step (see ROADMAP).
