// Book builder: `npm run book:build`. Generates the Typst sources of Book 1 "Doppelpunkt 1:
// Ankommen" (every A1 and A2 unit present under content/, the pronunciation drills and the mock
// exams) and its answer key from the same content as the app, then compiles them to PDF with the
// typst CLI when one is available (see docs/BOOKS.md). Output: books/build/ (git-ignored).
//
// The design lives in books/templates/doppelpunkt.typ; this file only turns content into calls of
// the template's functions. Every piece of content text goes through `esc` (plain text) or `md`
// (the Markdown subset allowed in grammar bodies, notes and common mistakes), so no character in
// the YAML can be read as Typst markup.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledUnit, Exercise, Level, MockExam, PronunciationDrill, Variety } from '@doppelpunkt/content-schema';
import { exerciseText } from './audio';
import type { LoadedExam } from './exam';
import { formatIssues, lintContent, repoRoot, repoVersion } from './lint';
import type { LoadedUnit } from './load';
import type { LoadedDrill } from './pronunciation';

// ---------------------------------------------------------------------------------------------
// Typst escaping
// ---------------------------------------------------------------------------------------------

/**
 * Characters with a meaning in Typst markup. Escaping all of them (with a backslash) is always
 * valid, so we do not try to be clever about context: `\` `#` `$` `*` `_` `@` `<` `>` `` ` `` `~`
 * `[` `]` `/` (comments, term lists) `=` (headings) `-` `+` (lists, dashes, soft hyphen `-?`).
 * Quotes stay unescaped so Typst prints language-correct typographic quotes.
 */
const MARKUP_SPECIAL = /[\\#$*_@<>`~[\]/=+-]/g;

/** Escape plain text for Typst markup. Newlines become spaces (use `escLines` to keep them). */
export function esc(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(MARKUP_SPECIAL, (c) => `\\${c}`)
    .replace(/\s*\n\s*/g, ' ')
    // "1. Stock" at the start of a content block would become a numbered list.
    .replace(/^(\s*\d+)\./, '$1\\.');
}

/** Escape text keeping its line breaks (transcripts, model dialogues). */
export function escLines(s: string): string {
  return s
    .trim()
    .split(/\r?\n/)
    .map((l) => esc(l.trim()))
    .filter((l) => l.length > 0)
    .join(' \\\n');
}

/** A Typst string literal. */
export function str(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

/** Content block `[...]` with escaped text. */
const c = (s: string) => `[${esc(s)}]`;

/** Inline Markdown (**strong**, *emphasis*) to Typst markup; everything else escaped. */
export function mdInline(s: string): string {
  let out = '';
  let last = 0;
  const re = /\*\*(.+?)\*\*|\*([^*\s](?:[^*]*?[^*\s])?)\*/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out += esc(s.slice(last, m.index));
    // Every embedded call ends with `;` so a following "." or "(" is read as text.
    out += m[1] !== undefined ? `#strong[${mdInline(m[1])}];` : `#emph[${mdInline(m[2]!)}];`;
    last = m.index + m[0].length;
  }
  out += esc(s.slice(last));
  return out.replace(/^(\s*\d+)\./, '$1\\.');
}

/** Block Markdown: paragraphs (blank lines) and "- " bullet lists, with inline formatting. */
export function md(s: string): string {
  const paras = s.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const blocks: string[] = [];
  for (const p of paras) {
    const lines = p.split('\n');
    const items: string[] = [];
    let text = '';
    const flush = () => {
      if (text.trim()) blocks.push(mdInline(text.trim()));
      text = '';
    };
    for (const line of lines) {
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li && !/^\s*\*\*/.test(line) && !/^\s*\*[^\s*]/.test(line)) {
        flush();
        items.push(li[1]!);
      } else if (items.length && !text) {
        items[items.length - 1] += ` ${line.trim()}`;
      } else {
        if (items.length) {
          blocks.push(items.map((i) => `- ${mdInline(i)}`).join('\n'));
          items.length = 0;
        }
        text += ` ${line.trim()}`;
      }
    }
    flush();
    if (items.length) blocks.push(items.map((i) => `- ${mdInline(i)}`).join('\n'));
  }
  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** FNV-1a hash of a string: the seed for deterministic shuffles. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * Deterministic permutation of 0..n-1 seeded by `seed`, never the identity (for n ≥ 2), so a
 * printed order item or matching column never shows the solution.
 */
export function permutation(n: number, seed: string): number[] {
  const idx = [...Array(n).keys()];
  let x = hash(seed) || 1;
  const rnd = () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  if (n >= 2 && idx.every((v, i) => v === i)) idx.push(idx.shift()!);
  return idx;
}

/** Shuffled order tokens that do not spell the model answer. */
export function scrambleTokens(tokens: string[], seed: string, answers: string[] = []): string[] {
  const norm = (s: string) => s.replace(/[.!?,]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const solved = new Set(answers.map(norm));
  for (let k = 0; k < 8; k++) {
    const out = permutation(tokens.length, `${seed}#${k}`).map((i) => tokens[i]!);
    if (!solved.has(norm(out.join(' ')))) return out;
  }
  return permutation(tokens.length, seed).map((i) => tokens[i]!);
}

const TYPE_LABEL: Record<Exercise['type'], string> = {
  mcq: 'Multiple choice', gap: 'Gap fill', order: 'Word order', match: 'Matching', dictation: 'Dictation',
  translate: 'Translation', transform: 'Transformation', speak: 'Speaking', write: 'Writing', roleplay: 'Role play',
};

const VARIETY_SHORT: Record<Variety, string> = { de: 'Standard German', 'ch-std': 'Swiss Standard German', 'gsw-zh': 'Zurich German', 'gsw-be': 'Bernese German' };
const TUTOR: Record<string, string> = { lena: 'Lena (friendly, Standard German)', keller: 'Frau Keller (formal)', reto: 'Reto (Zurich German)', explainer: 'the explainer' };

/** Number of ruled lines for a written answer of about `chars` characters. */
const linesFor = (chars: number, min = 1) => Math.max(min, Math.min(12, Math.ceil(chars / 70)));

// ---------------------------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------------------------

export type Track = { id: string; label: string; file: string };

/** Track registry of one unit or exam: `A1.03.04` or `A1.M1.02`. */
class Tracks {
  readonly list: Track[] = [];
  constructor(private readonly prefix: string, private readonly folder: string) {}
  add(label: string, file: string): string {
    const id = `${this.prefix}.${pad2(this.list.length + 1)}`;
    this.list.push({ id, label, file: `${this.folder}/${file}` });
    return id;
  }
}

/** Whether an exercise is heard rather than read: its text goes to the answer key only. */
export const isHeard = (ex: Exercise) => ex.type === 'dictation' || ex.skill === 'listening' || !!ex.transcript?.trim();

// ---------------------------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------------------------

export type Rendered = { book: string; key: string };

/**
 * Render one exercise for paper (`book`) and its solution (`key`). `n` is the printed number
 * (e.g. "3.14"), `trackId` the audio track the learner plays, if any.
 */
export function renderExercise(ex: Exercise, n: string, trackId?: string): Rendered {
  const v = ex.variety;
  const head = `#exercise(${str(n)}, kind: ${str(TYPE_LABEL[ex.type])}, skill: ${str(ex.skill)}, variety: ${str(v)}, prompt: ${c(ex.prompt)}${trackId ? `, track-id: ${str(trackId)}` : ''})`;
  const g = (s: string) => `#deu(${str(v)})[${esc(s)}];`;
  const gl = (s: string) => `#deu(${str(v)})[${escLines(s)}];`;
  const heard = isHeard(ex);
  const transcriptKey = ex.transcript?.trim() ? `#transcript[${gl(ex.transcript)}]` : '';
  const b = (x: string) => `#strong[${x}];`;
  const alsoKey = (xs: string[]) => (xs.length ? `#also[${xs.map((x) => g(x)).join(' · ')}]` : '');
  let body = '';
  let answer = '';

  switch (ex.type) {
    case 'mcq': {
      const q = ex.question ? `${g(ex.question)}\n\n` : '';
      body = `${q}#options((${ex.options.map((o) => `[${g(o)}]`).join(', ')},))`;
      answer = `${b(`${LETTERS[ex.answer]})`)} ${g(ex.options[ex.answer] ?? '')}`;
      break;
    }
    case 'gap': {
      const parts = ex.text.split('___');
      const many = ex.answers.length > 1;
      body = parts
        .map((p, i) => (i === 0 ? '' : `#gap(${(ex.answers[i - 1]?.[0] ?? '').length}${many ? `, n: ${i}` : ''});`) + esc(p))
        .join('');
      body = `#deu(${str(v)})[${body}]`;
      answer = ex.answers
        .map((a, i) => `${many ? `#super[${i + 1}] ` : ''}${b(g(a[0]!))}${alsoKey(a.slice(1))}`)
        .join(many ? ' #h(6pt) ' : '');
      break;
    }
    case 'order': {
      body = `#tokens((${scrambleTokens(ex.tokens, ex.id, ex.answers).map((t) => `[${esc(t)}]`).join(', ')},))\n#write-lines(1)`;
      answer = `${b(g(ex.answers[0]!))}${alsoKey(ex.answers.slice(1))}`;
      break;
    }
    case 'match': {
      const perm = permutation(ex.pairs.length, ex.id);
      const right = perm.map((i) => ex.pairs[i]![1]);
      body = `#match-cols((${ex.pairs.map((p) => `[${esc(p[0])}]`).join(', ')},), (${right.map((r) => `[${esc(r)}]`).join(', ')},))`;
      answer = ex.pairs.map((_, i) => `${b(String(i + 1))} ${LETTERS[perm.indexOf(i)]}`).join(' · ');
      break;
    }
    case 'dictation':
      body = `#write-lines(${linesFor(ex.transcript.length, 2)})`;
      answer = b(gl(ex.transcript));
      break;
    case 'translate':
      body = `${esc(ex.source)}\n#write-lines(${linesFor(ex.answers[0]!.length)})`;
      answer = `${b(g(ex.answers[0]!))}${alsoKey(ex.answers.slice(1))}`;
      break;
    case 'transform':
      body = `#text(font: sans, size: 0.8em, fill: muted)[${esc(VARIETY_SHORT[ex.from])} → ${esc(VARIETY_SHORT[ex.to])}] #h(4pt) #de(${str(ex.from)})[${esc(ex.source)}]\n#write-lines(${linesFor(ex.answers[0]!.length)})`;
      answer = `#de(${str(ex.to)})[${b(esc(ex.answers[0]!))}]${ex.answers.length > 1 ? `#also[${ex.answers.slice(1).map((a) => `#deu(${str(ex.to)})[${esc(a)}];`).join(' · ')}]` : ''}`;
      break;
    case 'speak':
      body = `#task-box[${gl(ex.target)}]\n#app-note[Say it aloud, then record yourself in the app to compare with the model${trackId ? ` (track ${esc(trackId)})` : ''}.]`;
      answer = `Model: ${gl(ex.target)}`;
      break;
    case 'write':
      body = `#task-box[${esc(ex.task)}${ex.minWords ? ` #text(fill: muted)[(at least ${ex.minWords} words)]` : ''}]\n#write-lines(${Math.max(5, Math.min(10, Math.ceil((ex.minWords ?? 40) / 8)))})\n#text(font: sans, size: 7.5pt, weight: "bold", fill: muted)[CHECK YOUR TEXT]\n#goals((${ex.checklist.map((x) => c(x)).join(', ')},))`;
      answer = `Model answer:\n#model[${gl(ex.model)}]`;
      break;
    case 'roleplay':
      body = `#task-box[${esc(ex.scenario)}]\n#text(font: sans, size: 7.5pt, weight: "bold", fill: muted)[GOALS]\n#goals((${ex.goals.map((x) => c(x)).join(', ')},))\n#app-note[Act it out with a partner, or practise with ${esc(TUTOR[ex.tutor] ?? ex.tutor)} in the app. A model dialogue is in the answer key.]`;
      answer = `Model dialogue:\n#model[${gl(ex.model)}]`;
      break;
  }

  // Listening items: the learner sees the question and the options, never what is said.
  if (heard && ex.type !== 'dictation' && transcriptKey) answer += `\n${transcriptKey}`;
  const book = `${head}[\n${body}\n]\n`;
  const key = `#key-item(${str(n)}, variety: ${str(v)}, kind: ${str(ex.type)})[${answer}][${mdInline(ex.explanation)}]\n`;
  return { book, key };
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export type BookConfig = {
  /** Output base name, e.g. doppelpunkt-1-ankommen. */
  slug: string;
  title: string;
  subtitle: string;
  levels: Level[];
  /** Public app URL for the QR placeholders. */
  appUrl: string;
  paper: 'a4' | 'iso-b5';
};

export const BOOK_1: BookConfig = {
  slug: 'doppelpunkt-1-ankommen',
  title: 'Doppelpunkt 1: Ankommen',
  subtitle: 'Ankommen',
  levels: ['A1', 'A2'],
  appUrl: 'https://oussamasegh.github.io/doppelpunkt',
  paper: 'a4',
};

const dialogueRows = (lines: CompiledUnit['intro']['dialogue']) =>
  `(${lines.map((l) => `(${c(l.speaker)}, ${str(l.variety)}, ${c(l.text)}, ${c(l.en)})`).join(', ')},)`;

function vocabRows(u: CompiledUnit): string {
  const rows = u.vocab.map((w) => {
    const gender = w.pos === 'noun' && w.gender && !w.pluralOnly ? str(w.gender) : 'none';
    const german = w.pluralOnly ? `${w.de} (pl.)` : w.de;
    const plural = w.pos === 'noun' && !w.pluralOnly ? (w.plural === '-' ? '–' : w.plural) : undefined;
    const swiss = [
      w.chStd ? `#vtag("ch-std") #deu("ch-std")[${esc(w.chStd)}];` : '',
      w.gswZh ? `#vtag("gsw-zh") #deu("gsw-zh")[${esc(w.gswZh)}];` : '',
      w.gswBe ? `#vtag("gsw-be") #deu("gsw-be")[${esc(w.gswBe)}];` : '',
    ].filter(Boolean).join(' \\ ');
    const example = w.example ? `[${esc(w.example.de)} #en[${esc(w.example.en)}]]` : 'none';
    return `(${c(german)}, ${gender}, ${plural ? c(plural) : 'none'}, ${c(w.en)}, ${swiss ? `[${swiss}]` : 'none'}, ${example})`;
  });
  return `(${rows.join(',\n  ')},)`;
}

function grammarBlock(u: CompiledUnit): string {
  return u.grammar.map((gp) => {
    const tables = gp.tables
      .filter((t) => t.length > 0)
      .map((t) => {
        const cols = Math.max(...t.map((r) => r.length));
        const cells = t.flatMap((r) => [...r, ...Array(cols - r.length).fill('')]).map((x) => `[${mdInline(x)}]`);
        return `#gtable(${cols}, ${cells.join(', ')})`;
      })
      .join('\n');
    const mistakes = gp.commonMistakes.length ? `#mistakes((${gp.commonMistakes.map((m) => `[${mdInline(m)}]`).join(', ')},))` : '';
    return `#grammar-point([${esc(gp.title)}])[\n${md(gp.body)}\n\n${tables}\n${mistakes}\n]`;
  }).join('\n\n');
}

export type UnitRender = { book: string; key: string; tracks: Track[]; exerciseIds: string[] };

/** Book chapter and answer-key section of one unit. */
export function renderUnit(u: CompiledUnit, appUrl: string): UnitRender {
  const level = u.level;
  const tracks = new Tracks(`${level}.${pad2(u.number)}`, `${level.toLowerCase()}/${u.id}`);
  const introTrack = tracks.add(`${u.id} intro dialogue (${u.intro.dialogue.length} lines)`, `audio/dialog-intro-01…${pad2(u.intro.dialogue.length)}.mp3`);
  const swissTrack = tracks.add(`${u.id} Swiss lane dialogue (${u.swiss.dialogue.length} lines)`, `audio/dialog-swiss-01…${pad2(u.swiss.dialogue.length)}.mp3`);

  const ex: Rendered[] = u.exercises.map((e, i) => {
    let t: string | undefined;
    const spoken = exerciseText(e);
    if (spoken) t = tracks.add(`${u.id} ${i + 1}: ${TYPE_LABEL[e.type].toLowerCase()} (${e.id})`, e.audio ?? `audio/ex-${e.id}.mp3`);
    else if (isHeard(e) && e.type !== 'roleplay') t = e.variety === 'de' ? introTrack : swissTrack; // "Listen to the dialogue again"
    return renderExercise(e, `${u.number}.${i + 1}`, t);
  });

  const swissTitle = u.swiss.dialogue.some((l) => l.variety === 'gsw-be') ? 'Swiss lane: Züritüütsch und Bärndütsch' : 'Swiss lane: Züritüütsch';
  const book = [
    `#unit-opener(level: ${str(level)}, number: ${u.number}, unit-id: ${str(u.id)}, title: ${c(u.title)}, title-en: ${c(u.titleEn)}, goal: ${c(u.goal)}, can-do: (${u.canDo.map(c).join(', ')},), url: ${str(`${appUrl}/unit/${u.id}`)})`,
    `=== Dialogue`,
    `#scene[${esc(u.intro.scene)}]`,
    `#dialogue(${dialogueRows(u.intro.dialogue)}, track-id: ${str(introTrack)})`,
    `=== Grammar`,
    grammarBlock(u),
    `=== Vocabulary`,
    `#vocab-table(${vocabRows(u)})`,
    u.reading ? `=== Reading\n#reading([${esc(u.reading.title)}])[#deu("de")[${md(u.reading.text)}]]\n#app-note[The English translation is in the answer key.]` : '',
    `#swiss-lane([${esc(swissTitle)}])[\n#scene[${esc(u.swiss.scene)}]\n#dialogue(${dialogueRows(u.swiss.dialogue)}, track-id: ${str(swissTrack)})\n#v(2mm)\n#notes((${u.swiss.notes.map((n) => `[${mdInline(n)}]`).join(', ')},))\n]`,
    `=== Exercises`,
    ...ex.map((r) => r.book),
  ].filter(Boolean).join('\n\n');

  const key = [
    `== ${level} · ${u.number} #h(0.4em) ${esc(u.title)}`,
    u.reading ? `#key-item("R", kind: "reading")[#strong[${esc(u.reading.title)}]; – translation: #en[${esc(u.reading.en)}]][]` : '',
    ...ex.map((r) => r.key),
  ].filter(Boolean).join('\n');
  return { book, key, tracks: tracks.list, exerciseIds: u.exercises.map((e) => e.id) };
}

// ---------------------------------------------------------------------------------------------
// Appendices: pronunciation drills, mock exams
// ---------------------------------------------------------------------------------------------

export function renderDrill(d: PronunciationDrill, appUrl: string): string {
  const ipa = d.ipa.length ? ` #text(fill: muted)[/${d.ipa.map(esc).join(', ')}/]` : '';
  const pairs = d.pairs.length
    ? `#table(columns: (1fr, 1fr), table.header([A], [B]), ${d.pairs.map(([a, b]) => `[#deu(${str(d.variety)})[*${esc(a.text)}*]; #en[${esc(a.en)}]], [#deu(${str(d.variety)})[*${esc(b.text)}*]; #en[${esc(b.en)}]]`).join(', ')})`
    : '';
  const words = d.words.map((w) => `#deu(${str(d.variety)})[*${esc(w.text)}*]; #en[${esc(w.en)}]`).join(' · ');
  const sentences = d.sentences.map((s) => `- #de(${str(d.variety)})[${esc(s.text)}] #en[${esc(s.en)}]`).join('\n');
  return [
    `==== #vtag(${str(d.variety)}) ${esc(d.title)}${ipa} #h(1fr) #text(font: sans, size: 7pt, fill: muted)[${esc(d.level)} · ${esc(`${appUrl}/pronunciation/${d.id}`)}]`,
    md(d.explanation),
    d.tips.length ? `#notes((${d.tips.map((t) => `[${mdInline(t)}]`).join(', ')},), color: gold)` : '',
    pairs ? `*Minimal pairs*\n${pairs}` : '',
    `*Words* #h(4pt) ${words}`,
    sentences ? `*Sentences*\n${sentences}` : '',
    d.commonMistakes.length ? `#mistakes((${d.commonMistakes.map((m) => `[${mdInline(m)}]`).join(', ')},))` : '',
  ].filter(Boolean).join('\n\n');
}

export type ExamRender = { book: string; key: string; tracks: Track[]; exerciseIds: string[] };

export function renderExam(x: MockExam, index: number, appUrl: string): ExamRender {
  const tracks = new Tracks(`${x.level}.M${index}`, `${x.level.toLowerCase()}/${x.id}`);
  const book: string[] = [
    `== ${esc(x.title)}`,
    `#text(font: sans, size: 8pt, fill: muted)[${esc(x.id)} · pass mark ${Math.round(x.passMark * 100)} % · do it timed in the app: ${esc(`${appUrl}/exam/${x.id}`)}]`,
  ];
  const key: string[] = [`== ${esc(x.title)}`];
  const ids: string[] = [];
  x.sections.forEach((s, si) => {
    const total = s.exercises.reduce((n, _, i) => n + (s.points?.[i] ?? 1), 0);
    const listening = s.skill === 'listening';
    book.push(`=== ${esc(s.title)} #h(1fr) #text(size: 8pt, weight: "regular", fill: muted)[${s.minutes} min · ${total} points]`, md(s.instructions));
    key.push(`=== ${esc(s.title)}`);
    let stimulusTrack: string | undefined;
    if (s.stimulus) {
      if (listening) {
        stimulusTrack = tracks.add(`${x.id} ${s.title}${s.stimulus.title ? `: ${s.stimulus.title}` : ''}`, s.stimulus.audio ?? `audio/stimulus-${s.id}.mp3`);
        book.push(`#track(${str(stimulusTrack)}) #h(4pt) ${s.stimulus.title ? esc(s.stimulus.title) : ''}`);
        key.push(`#key-item("T", variety: ${str(s.stimulus.variety)}, kind: "transcript")[Transcript ${esc(stimulusTrack)}\n#transcript[#deu(${str(s.stimulus.variety)})[${escLines(s.stimulus.text)}]]][]`);
      } else {
        book.push(`#reading([${s.stimulus.title ? esc(s.stimulus.title) : ''}])[#deu(${str(s.stimulus.variety)})[${escLines(s.stimulus.text)}]]`);
      }
    }
    s.exercises.forEach((e, i) => {
      const spoken = exerciseText(e);
      let t: string | undefined;
      if (spoken && (listening || e.type === 'dictation')) t = tracks.add(`${x.id} ${s.title} ${i + 1} (${e.id})`, e.audio ?? `audio/ex-${e.id}.mp3`);
      else if (listening) t = stimulusTrack;
      const r = renderExercise(e, `${si + 1}.${i + 1}`, t);
      book.push(r.book);
      key.push(r.key);
      ids.push(e.id);
    });
  });
  return { book: book.join('\n\n'), key: key.join('\n'), tracks: tracks.list, exerciseIds: ids };
}

// ---------------------------------------------------------------------------------------------
// Whole book
// ---------------------------------------------------------------------------------------------

export type BookInput = {
  units: LoadedUnit[];
  drills: LoadedDrill[];
  exams: LoadedExam[];
  version: string;
  /** Units with both native sign-offs; when fewer than all, the book is marked as a draft. */
  reviewed?: number;
};

export type BookSources = {
  book: string;
  key: string;
  units: string[];
  exerciseIds: string[];
  tracks: Track[];
  stats: { units: number; exercises: number; vocab: number; drills: number; exams: number };
};

/** The generated sources import the template from their own folder; the builder copies it there. */
export const TEMPLATE_IMPORT = 'doppelpunkt.typ';

export function buildBookSources(input: BookInput, cfg: BookConfig = BOOK_1): BookSources {
  const units = input.units
    .filter((u) => cfg.levels.includes(u.level))
    .sort((a, b) => cfg.levels.indexOf(a.level) - cfg.levels.indexOf(b.level) || a.number - b.number);
  const exams = input.exams
    .filter((e) => cfg.levels.includes(e.level))
    .sort((a, b) => cfg.levels.indexOf(a.level) - cfg.levels.indexOf(b.level) || a.exam.id.localeCompare(b.exam.id));
  const drillOrder: Variety[] = ['de', 'ch-std', 'gsw-zh', 'gsw-be'];
  const drills = input.drills
    .map((d) => d.drill)
    .filter((d) => cfg.levels.includes(d.level))
    .sort((a, b) => cfg.levels.indexOf(a.level) - cfg.levels.indexOf(b.level) || drillOrder.indexOf(a.variety) - drillOrder.indexOf(b.variety) || a.title.localeCompare(b.title));

  const levelsLabel = cfg.levels.length > 1 ? `${cfg.levels[0]}–${cfg.levels[cfg.levels.length - 1]}` : cfg.levels[0]!;
  const draft = (input.reviewed ?? 0) < units.length;
  const stats = {
    units: units.length,
    exercises: units.reduce((n, u) => n + u.unit.exercises.length, 0),
    vocab: units.reduce((n, u) => n + u.unit.vocab.length, 0),
    drills: drills.length,
    exams: exams.length,
  };
  const statsLine = `${stats.units} units · ${stats.vocab} words · ${stats.exercises} exercises · ${stats.drills} pronunciation drills · ${stats.exams} mock exams`;
  const preamble = (kind: 'book' | 'key') => [
    `// Generated by npm run book:build from content/. Do not edit: change the YAML or books/templates/.`,
    `#import ${str(TEMPLATE_IMPORT)}: *`,
    `#show: book.with(title: ${str(cfg.title)}, subtitle: ${str(cfg.subtitle)}, kind: ${str(kind)}, version: ${str(input.version)}, paper: ${str(cfg.paper)}, app-url: ${str(cfg.appUrl)}, draft: ${draft})`,
    `#title-page(title: ${str(cfg.title)}, subtitle: ${str(cfg.subtitle)}, levels: ${str(levelsLabel)}, kind: ${str(kind)}, version: ${str(input.version)}, app-url: ${str(cfg.appUrl)}, draft: ${draft}, stats: ${c(statsLine)})`,
  ].join('\n');

  const rendered = units.map((u) => ({ lu: u, r: renderUnit(u.unit, cfg.appUrl) }));
  const examR = exams.map((e, i) => renderExam(e.exam, i + 1, cfg.appUrl));
  const tracks = [...rendered.flatMap((x) => x.r.tracks), ...examR.flatMap((x) => x.tracks)];

  const howTo = [
    `== How to use this book`,
    `This book contains every unit of the Doppelpunkt app for ${esc(levelsLabel)}, printed from the same content. Each unit has a dialogue, grammar with tables and common mistakes, a vocabulary list, a reading text, the Swiss lane and exercises for paper. The answer key (a separate free PDF) has every solution with its explanation and the transcripts of all listening items.`,
    `Every German sentence carries a small tag for its variety, like in the app. Standard German is marked in gold, Swiss German in red:`,
    `#legend()`,
    `#v(3mm)`,
    `Audio, automatic checking, speaking feedback and the AI tutors are in the app. Scan the QR code on a unit's first page or open ${esc(cfg.appUrl)}.${draft ? ` #text(fill: swiss)[This edition is a draft: ${input.reviewed ?? 0} of ${units.length} units have passed native review.]` : ''}`,
    `#heading(level: 2, outlined: false)[Contents]`,
    `#outline(title: none, depth: 2)`,
  ].join('\n\n');

  const bookParts: string[] = [preamble('book'), howTo];
  for (const level of cfg.levels) {
    const lv = rendered.filter((x) => x.lu.level === level);
    if (!lv.length) continue;
    bookParts.push(`#part([${level}], label: "Level")`);
    bookParts.push(...lv.map((x) => x.r.book));
  }
  bookParts.push(`#part([Appendix], label: "Back matter")`);
  if (drills.length) {
    bookParts.push(`== Pronunciation drills\n\nOne sound or contrast per drill. Listen and repeat in the app (Pronunciation); the drills follow the order of the course.`);
    bookParts.push(...drills.map((d) => renderDrill(d, cfg.appUrl)));
  }
  bookParts.push(...examR.map((x) => x.book));
  bookParts.push(`== Track list\n\nEvery audio track printed in the book, with the file the app plays. Open the unit in the app to listen; recordings that are not ready yet are read by text-to-speech for Standard German.\n\n#track-list((${tracks.map((t) => `(${str(t.id)}, ${c(t.label)}, ${c(t.file)})`).join(',\n  ')},))`);

  const keyParts: string[] = [preamble('key'), `#heading(level: 2, outlined: false)[Contents]\n\n#outline(title: none, depth: 2)`];
  for (const level of cfg.levels) {
    const lv = rendered.filter((x) => x.lu.level === level);
    if (!lv.length) continue;
    keyParts.push(...lv.map((x) => x.r.key));
  }
  keyParts.push(...examR.map((x) => x.key));

  return {
    book: bookParts.join('\n\n') + '\n',
    key: keyParts.join('\n\n') + '\n',
    units: units.map((u) => u.unit.id),
    exerciseIds: [...rendered.flatMap((x) => x.r.exerciseIds), ...examR.flatMap((x) => x.exerciseIds)],
    tracks,
    stats,
  };
}

// ---------------------------------------------------------------------------------------------
// Typst CLI
// ---------------------------------------------------------------------------------------------

/** Typst version the template is written for; CI installs the same one. */
export const TYPST_VERSION = '0.13.1';

export type Compiler =
  | { kind: 'cli'; bin: string; version: string }
  | { kind: 'python'; python: string; version: string };

const run = (cmd: string, args: string[], opts: { timeout?: number } = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 60_000 });

function cliVersion(bin: string): string | undefined {
  const r = run(bin, ['--version']);
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** Release asset name for this machine, if typst publishes one we can unpack with tar. */
function releaseTarget(): string | undefined {
  const a = arch() === 'x64' ? 'x86_64' : arch() === 'arm64' ? 'aarch64' : undefined;
  if (!a) return undefined;
  if (platform() === 'linux') return `typst-${a}-unknown-linux-musl`;
  if (platform() === 'darwin') return `typst-${a}-apple-darwin`;
  return undefined;
}

export const typstCacheDir = (root = repoRoot) => join(root, 'node_modules', '.cache', 'typst', TYPST_VERSION);

/** Download the typst release binary into the cache with curl + tar. Returns the binary path. */
function downloadTypst(cache: string, log: string[]): string | undefined {
  const target = releaseTarget();
  if (!target) { log.push(`typst: no release binary for ${platform()}/${arch()}`); return undefined; }
  const url = `https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/${target}.tar.xz`;
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, `${target}.tar.xz`);
  log.push(`typst: downloading ${url}`);
  const dl = run('curl', ['-sSfL', '--retry', '2', '-o', archive, url], { timeout: 180_000 });
  if (dl.status !== 0) { log.push(`typst: download failed (${(dl.stderr || dl.error?.message || '').trim().split('\n')[0]})`); return undefined; }
  const tar = run('tar', ['-xJf', archive, '-C', cache]);
  rmSync(archive, { force: true });
  const bin = join(cache, target, 'typst');
  if (tar.status !== 0 || !existsSync(bin)) { log.push('typst: could not unpack the release archive'); return undefined; }
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * Find a typst compiler: --typst / TYPST_BIN, `typst` on PATH, the cached release binary, a
 * fresh download into the cache (unless `download` is false), then the Python package
 * (`pip install typst`). Returns undefined when none works.
 */
export function findTypst(opts: { bin?: string; download?: boolean; root?: string } = {}, log: string[] = []): Compiler | undefined {
  const candidates = [opts.bin, process.env.TYPST_BIN, 'typst', join(typstCacheDir(opts.root), releaseTarget() ?? 'none', 'typst')].filter((x): x is string => !!x);
  for (const bin of candidates) {
    const version = cliVersion(bin);
    if (version) return { kind: 'cli', bin, version };
  }
  if (opts.download !== false) {
    const bin = downloadTypst(typstCacheDir(opts.root), log);
    const version = bin ? cliVersion(bin) : undefined;
    if (bin && version) return { kind: 'cli', bin, version };
  }
  for (const python of ['python3', 'python']) {
    const r = run(python, ['-I', '-c', 'import typst, importlib.metadata as m; print(m.version("typst"))']);
    if (r.status === 0) return { kind: 'python', python, version: `typst (python) ${r.stdout.trim()}` };
  }
  return undefined;
}

/** Compile one .typ file to PDF with `root` as the Typst project root. */
export function compileTypst(comp: Compiler, input: string, output: string, root: string): { ok: boolean; message: string } {
  const r = comp.kind === 'cli'
    ? run(comp.bin, ['compile', '--root', root, input, output], { timeout: 600_000 })
    : run(comp.python, ['-I', '-c', 'import sys, typst; typst.compile(sys.argv[1], output=sys.argv[2], root=sys.argv[3])', input, output, root], { timeout: 600_000 });
  const message = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0 && existsSync(output), message };
}

/** Page count of a PDF: pdfinfo when installed, otherwise the /Type /Page objects. */
export function pdfPages(file: string): number {
  const info = run('pdfinfo', [file]);
  const m = info.status === 0 ? /Pages:\s+(\d+)/.exec(info.stdout) : null;
  if (m) return Number(m[1]);
  return (readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

export const BOOKS_DIR = join(repoRoot, 'books');
export const BUILD_DIR = join(BOOKS_DIR, 'build');
export const TEMPLATE_FILE = join(BOOKS_DIR, 'templates', 'doppelpunkt.typ');

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2)): number {
  const contentDir = resolve(argValue(argv, '--content') ?? join(repoRoot, 'content'));
  const outDir = resolve(argValue(argv, '--out') ?? BUILD_DIR);
  const paper = argValue(argv, '--paper') === 'b5' ? 'iso-b5' : 'a4';
  const cfg: BookConfig = { ...BOOK_1, paper, appUrl: process.env.BOOK_APP_URL?.trim() || BOOK_1.appUrl, slug: paper === 'a4' ? BOOK_1.slug : `${BOOK_1.slug}-b5` };

  const lint = lintContent(contentDir, repoRoot);
  if (lint.errors) {
    console.log(formatIssues(lint.issues.filter((i) => i.severity === 'error')));
    if (!argv.includes('--skip-invalid')) {
      console.log(`\nNot building the book: ${lint.errors} content error(s). Run npm run content:lint (or preview with --skip-invalid).`);
      return 1;
    }
    console.log(`\n--skip-invalid: building a preview without the ${lint.errors} broken file(s) above. Do not publish it.`);
  }
  const reviewed = lint.review.filter((r) => r.de && r.ch && cfg.levels.some((l) => r.unitId.startsWith(l.toLowerCase()))).length;
  const src = buildBookSources({ units: lint.units, drills: lint.drills, exams: lint.exams, version: repoVersion(), reviewed }, cfg);

  mkdirSync(outDir, { recursive: true });
  const files = [
    { typ: join(outDir, `${cfg.slug}.typ`), pdf: join(outDir, `${cfg.slug}.pdf`), text: src.book },
    { typ: join(outDir, `${cfg.slug}-answer-key.typ`), pdf: join(outDir, `${cfg.slug}-answer-key.pdf`), text: src.key },
  ];
  for (const f of files) writeFileSync(f.typ, f.text);
  // The sources import the template from their own folder, so books/build/ compiles on its own.
  copyFileSync(TEMPLATE_FILE, join(outDir, TEMPLATE_IMPORT));
  const rel = (p: string) => relative(repoRoot, p);
  console.log(`${cfg.title}: ${src.units.join(', ')}`);
  console.log(`${src.stats.units} unit(s), ${src.stats.exercises} unit exercise(s), ${src.stats.vocab} word(s), ${src.stats.drills} drill(s), ${src.stats.exams} mock exam(s), ${src.tracks.length} track(s)`);
  for (const f of files) console.log(`wrote ${rel(f.typ)}`);

  if (argv.includes('--typ-only')) return 0;
  const log: string[] = [];
  const comp = findTypst({ bin: argValue(argv, '--typst'), download: !argv.includes('--no-download') && process.env.BOOK_NO_DOWNLOAD !== '1' }, log);
  log.forEach((l) => console.log(l));
  if (!comp) {
    console.log('typst not found: generated .typ only. Install typst (https://github.com/typst/typst) or `pip install typst`, then run npm run book:build again.');
    return argv.includes('--require-pdf') ? 1 : 0;
  }
  if (comp.version && !comp.version.includes(TYPST_VERSION)) console.log(`note: the template is written for typst ${TYPST_VERSION}; using ${comp.version}`);
  let ok = true;
  for (const f of files) {
    const r = compileTypst(comp, f.typ, f.pdf, outDir);
    if (!r.ok) { ok = false; console.log(`typst failed for ${rel(f.typ)}:\n${r.message}`); continue; }
    console.log(`compiled ${rel(f.pdf)} (${pdfPages(f.pdf)} pages) with ${comp.version}`);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
