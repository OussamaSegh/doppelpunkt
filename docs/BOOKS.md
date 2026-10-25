# Books

Book 1 **"Doppelpunkt 1: Ankommen"** (A1–A2) and its answer key are printed from the same YAML as
the app, with [Typst](https://typst.app). Both PDFs are free. Later books (Mitreden, the Swiss
companion, Grammatik kompakt) will reuse the same generator with another `BookConfig`.

## Build

```sh
npm run book:build                 # .typ sources + PDFs in books/build/ (git-ignored)
npm run book:build -- --paper b5   # B5 edition (…-b5.pdf)
npm run book:build -- --typ-only   # sources only, no compiler needed
```

Options: `--typst <path>`, `--no-download` (or `BOOK_NO_DOWNLOAD=1`), `--require-pdf` (exit 1 when no
compiler is found, used in CI), `--content <dir>`, `--out <dir>`. `BOOK_APP_URL` overrides the app URL
printed under the QR placeholders (default `https://oussamasegh.github.io/doppelpunkt`).

The builder lints the content first and refuses to build on content errors, like `content:build`.
`--skip-invalid` builds a preview from the units that load (units that fail to parse are left out)
while someone is still writing a unit; never publish such a build.
It looks for a compiler in this order:

1. `--typst` or `TYPST_BIN`, then `typst` on `PATH`;
2. the cached release binary in `node_modules/.cache/typst/<version>/`;
3. a download of the official release (Linux and macOS, x86_64 / arm64, with `curl` and `tar`) into
   that cache;
4. the Python package (`pip install typst`);
5. otherwise it writes the `.typ` files only and says so.

The template is written for **typst 0.13.1** (`TYPST_VERSION` in `tools/src/book.ts`); CI pins the
same version.

## Output

| File | What |
|---|---|
| `books/build/doppelpunkt-1-ankommen.pdf` | the book |
| `books/build/doppelpunkt-1-ankommen-answer-key.pdf` | the answer key |
| `books/build/*.typ`, `doppelpunkt.typ` | generated sources and a copy of the template (they compile on their own) |

## How it works

- `tools/src/book.ts` loads every unit, drill and mock exam (through `lintContent`), keeps the levels
  of the book (`BOOK_1.levels = ['A1', 'A2']`) and writes Typst markup that calls the functions in
  `books/templates/doppelpunkt.typ`. Nothing is hard-coded per unit: new A2 units appear as soon as
  they lint.
- **The design lives only in the template.** Change colours, fonts, page size or layout there; change
  words in `content/`.
- **Escaping.** Every content string goes through `esc` (plain text: `\ # $ * _ @ < > `` ` `` ~ [ ] / = + -`
  are backslash-escaped, newlines flattened, `1.` at the start protected) or `md` (the Markdown
  subset allowed in grammar bodies, notes and common mistakes: `**strong**`, `*emphasis*`, paragraphs
  and `- ` lists). Embedded calls end with `;` so a following `.` or `(` stays text.

### Book

Title page with a QR placeholder, how to use the book (variety legend), contents, then one part per
level and one chapter per unit:

1. **Opener:** title, English title, goal, can-do checklist, QR placeholder for `/unit/<id>`.
2. **Dialogue:** scene, German and English side by side, one track for the whole dialogue.
3. **Grammar:** body, tables (header row tinted gold), common mistakes.
4. **Vocabulary:** article coloured and printed (der blue, die purple, das green – never gold or
   red, which mean varieties), plural (`–` = none), English, Swiss forms (CH / ZH / BE tags), example.
5. **Reading** (translation in the key).
6. **Swiss lane:** red accent bar and tint, dialect dialogue, notes.
7. **Exercises**, numbered `<unit>.<n>` like the app's order, each with skill, type and variety tag
   (badge gold for Standard, red for Swiss):

| Type | On paper |
|---|---|
| mcq | a) b) c) with circles |
| gap | a line per `___`, about as long as the model answer, numbered when there are several |
| order | the tokens scrambled (deterministic, never in a correct order) and an answer line |
| match | numbered left column, lettered right column (shuffled), answer blanks |
| dictation | track + ruled lines |
| translate / transform | source (transform with the variety direction) + ruled lines |
| speak | the text to read aloud + model track |
| write | task, word count, ruled lines, the self-assessment checklist |
| roleplay | scenario, goals as checkboxes, which tutor to practise with in the app |

Every German sentence carries the small DE / CH / ZH / BE tag the app shows as `VarietyTag`.

**Listening:** an item is "heard" when it is a dictation, has skill `listening` or has a
`transcript`. The book then prints the question and options and a **track** badge, never what is
said; the transcript is printed in the answer key. Tracks are numbered `A1.03.04` (level, unit,
track) and `A1.M1.02` for mock exams: `01` is the intro dialogue, `02` the Swiss lane dialogue, then
every exercise that has a recording slot in the audio manifest (`ex-<id>.mp3`). Listening items
that refer to "the dialogue" point to the dialogue track.

**Appendix:** pronunciation drills (A1–A2, Standard first, then Swiss), the mock exams of the book's
levels (reading stimuli printed, listening stimuli as tracks), and a track list mapping each track to
the file the app plays (`<level>/<unit or exam id>/audio/…`).

### Answer key

One section per unit and mock exam: for every exercise the model answer in bold with all other
accepted answers, the explanation, and for listening items the transcript; the reading translation;
model texts for write and roleplay items; mock-exam listening transcripts.

## CI

`.github/workflows/books.yml` runs on changes to `content/`, `books/` or the generator (and by
hand): installs typst 0.13.1 with `typst-community/setup-typst`, the Inter font, runs the generator
tests, `npm run book:build -- --require-pdf --no-download`, prints the page counts and uploads both
PDFs (and the sources) as the workflow artifact `doppelpunkt-1-ankommen-pdf`.

## Tests

`tools/test/book.test.ts`: escaping and Markdown, deterministic shuffles, every exercise type renders
its paper form, transcripts and models only in the key, every solution in the key, every A1/A2 unit
and every exercise of the real content included. When a typst binary is available (PATH,
`TYPST_BIN` or the cache) it also compiles a small book full of special characters.

## Before printing

The book shows "Draft" in the footer until every unit has both native sign-offs (`review` in
`unit.yaml`). Proofread the PDF as a whole (ROADMAP v1.0 exit criteria): line breaks in tables,
page breaks inside exercises and dialect spellings are worth a look.
