import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompiledUnit, Exercise, MockExam, type ExerciseType } from '@doppelpunkt/content-schema';
import {
  BOOK_1, TEMPLATE_FILE, TEMPLATE_IMPORT, buildBookSources, compileTypst, esc, escLines, findTypst, md, mdInline,
  pdfPages, permutation, renderExercise, scrambleTokens, str,
} from '../src/book';
import { loadExams } from '../src/exam';
import { loadContent } from '../src/load';
import { repoRoot } from '../src/lint';
import { loadDrills } from '../src/pronunciation';

const NASTY = 'a#b $c *d* _e_ @f <g> `h` ~i [j] \\k // l = m - n + o';
const base = { prompt: 'Do it.', explanation: 'Because *this*.' };

/** One exercise of every type, with Typst-special characters in the texts. */
const ALL: Exercise[] = [
  { ...base, id: 'x-mcq', type: 'mcq', skill: 'grammar', question: 'Du ___ Tom #1?', options: ['bist', 'bin $5', 'ist'], answer: 1 },
  { ...base, id: 'x-gap', type: 'gap', skill: 'grammar', text: 'Ich ___ Tom, du ___ Anna.', answers: [['bin'], ['bist', 'bisst']] },
  { ...base, id: 'x-order', type: 'order', skill: 'grammar', tokens: ['Ich', 'komme', 'aus', 'England'], answers: ['Ich komme aus England.'] },
  { ...base, id: 'x-match', type: 'match', skill: 'vocabulary', pairs: [['eins', 'one'], ['zwei', 'two'], ['drei', 'three']] },
  { ...base, id: 'x-dict', type: 'dictation', skill: 'listening', transcript: 'Guten Tag! Ich heiße_Anna.' },
  { ...base, id: 'x-tr', type: 'translate', skill: 'writing', source: 'Where do you live? <home>', answers: ['Wo wohnst du?'] },
  { ...base, id: 'x-tf', type: 'transform', skill: 'reading', variety: 'gsw-zh', from: 'gsw-zh', to: 'de', source: 'Vo wo chunnsch?', answers: ['Woher kommst du?'] },
  { ...base, id: 'x-speak', type: 'speak', skill: 'speaking', target: 'Guten Morgen @all!' },
  { ...base, id: 'x-write', type: 'write', skill: 'writing', task: 'Write about you.', minWords: 30, model: 'Hallo! Ich heiße Sarah.', checklist: ['I use heißen.'] },
  { ...base, id: 'x-rp', type: 'roleplay', skill: 'speaking', scenario: 'Meet Lena.', goals: ['Say hi.'], model: 'Lena: Hallo!\nDu: Hallo Lena!' },
].map((e) => Exercise.parse(e));

describe('Typst escaping', () => {
  it('escapes every markup character', () => {
    const out = esc(NASTY);
    for (const ch of ['#', '$', '*', '_', '@', '<', '>', '`', '~', '[', ']', '/', '=', '-', '+']) {
      expect(out).not.toMatch(new RegExp(`(^|[^\\\\])\\${ch}`));
    }
    expect(out).toContain('\\\\k');
  });
  it('keeps numbers at the start from becoming a list and flattens newlines', () => {
    expect(esc('1. Stock')).toBe('1\\. Stock');
    expect(esc('a\n\nb')).toBe('a b');
    expect(escLines('Reto: Hoi\nSandra: Sali')).toBe('Reto: Hoi \\\nSandra: Sali');
  });
  it('writes string literals', () => {
    expect(str('say "hi" \\ now')).toBe('"say \\"hi\\" \\\\ now"');
  });
  it('turns the Markdown subset into Typst calls and escapes the rest', () => {
    expect(mdInline('**sein** is *irregular*. #1')).toBe('#strong[sein]; is #emph[irregular];. \\#1');
    expect(mdInline('a * b')).toBe('a \\* b');
    expect(md('Intro:\n- **a** one\n- b two\n\nNext')).toBe('Intro:\n\n- #strong[a]; one\n- b two\n\nNext');
  });
});

describe('deterministic shuffles', () => {
  it('never prints the solution order', () => {
    for (let n = 2; n < 8; n++) {
      const p = permutation(n, `seed-${n}`);
      expect([...p].sort()).toEqual([...Array(n).keys()]);
      expect(p).not.toEqual([...Array(n).keys()]);
      expect(permutation(n, `seed-${n}`)).toEqual(p);
    }
    const t = scrambleTokens(['Ich', 'komme', 'aus', 'England'], 'x', ['Ich komme aus England.']);
    expect(t.join(' ')).not.toBe('Ich komme aus England');
  });
});

describe('exercises on paper', () => {
  const rendered = ALL.map((e, i) => ({ e, r: renderExercise(e, `1.${i + 1}`, e.type === 'dictation' ? 'A1.01.03' : undefined) }));

  it('renders all ten types', () => {
    const types = new Set<ExerciseType>(ALL.map((e) => e.type));
    expect(types.size).toBe(10);
    for (const { r } of rendered) expect(r.book).toMatch(/^#exercise\(/);
  });

  it('uses the paper form of each type', () => {
    const book = (t: ExerciseType) => rendered.find((x) => x.e.type === t)!.r.book;
    expect(book('mcq')).toContain('#options(');
    expect(book('gap').match(/#gap\(/g)).toHaveLength(2);
    expect(book('order')).toContain('#tokens(');
    expect(book('match')).toContain('#match-cols(');
    expect(book('dictation')).toContain('track-id: "A1.01.03"');
    expect(book('write')).toContain('#write-lines(');
    expect(book('roleplay')).toContain('#goals(');
  });

  it('puts transcripts and models in the key only', () => {
    const dict = rendered.find((x) => x.e.type === 'dictation')!.r;
    expect(dict.book).not.toContain('Guten Tag');
    expect(dict.key).toContain('Guten Tag');
    const listen = renderExercise(Exercise.parse({ ...base, id: 'x-l', type: 'mcq', skill: 'listening', transcript: 'Reto: Ich bi müed.', options: ['tired', 'hungry'], answer: 0 }), '1.1', 'A1.01.04');
    expect(listen.book).not.toContain('müed');
    expect(listen.key).toContain('müed');
    const rp = rendered.find((x) => x.e.type === 'roleplay')!.r;
    expect(rp.book).not.toContain('Hallo Lena');
    expect(rp.key).toContain('Hallo Lena');
  });

  it('gives every solution in the key', () => {
    const key = (t: ExerciseType) => rendered.find((x) => x.e.type === t)!.r.key;
    expect(key('mcq')).toContain('b)');
    expect(key('mcq')).toContain('bin \\$5');
    expect(key('gap')).toContain('bin');
    expect(key('gap')).toContain('bisst');
    expect(key('order')).toContain('Ich komme aus England.');
    expect(key('translate')).toContain('Wo wohnst du?');
    expect(key('transform')).toContain('Woher kommst du?');
    expect(key('write')).toContain('Sarah');
    for (const { r } of rendered) expect(r.key).toContain('#emph[this];');
  });

  it('maps matching answers to the shuffled letters', () => {
    const e = ALL.find((x) => x.type === 'match')!;
    if (e.type !== 'match') throw new Error();
    const p = permutation(e.pairs.length, e.id);
    const key = rendered.find((x) => x.e.type === 'match')!.r.key;
    e.pairs.forEach((_, i) => expect(key).toContain(`#strong[${i + 1}]; ${'abc'[p.indexOf(i)]}`));
  });
});

describe('Book 1 from the real content', () => {
  const content = join(repoRoot, 'content');
  const units = loadContent(content, repoRoot).units;
  const exams = loadExams(content, repoRoot).exams;
  const drills = loadDrills(content, repoRoot).drills;
  const src = buildBookSources({ units, exams, drills, version: '0.0.0-test' });

  it('includes every A1 and A2 unit present, in order', () => {
    const expected = units.filter((u) => u.level === 'A1' || u.level === 'A2').map((u) => u.unit.id).sort();
    expect([...src.units].sort()).toEqual(expected);
    expect(src.units.filter((id) => id.startsWith('a1'))).toHaveLength(12);
    for (const id of src.units) {
      const u = units.find((x) => x.unit.id === id)!.unit;
      expect(src.book).toContain(`unit-id: "${id}"`);
      expect(src.book).toContain(esc(u.title));
    }
  });

  it('has a key entry for every exercise of the units and the exams', () => {
    const all = [
      ...units.filter((u) => BOOK_1.levels.includes(u.level)).flatMap((u) => u.unit.exercises.map((e) => e.id)),
      ...exams.filter((x) => BOOK_1.levels.includes(x.level)).flatMap((x) => x.exam.sections.flatMap((s) => s.exercises.map((e) => e.id))),
    ];
    expect(src.exerciseIds).toEqual(expect.arrayContaining(all));
    expect(src.exerciseIds).toHaveLength(all.length);
    const keyItems = src.key.match(/#key-item\("\d+\.\d+"/g) ?? [];
    expect(keyItems).toHaveLength(all.length);
    const bookItems = src.book.match(/#exercise\("\d+\.\d+"/g) ?? [];
    expect(bookItems).toHaveLength(all.length);
  });

  it('prints every solution', () => {
    // Spot-check: every mcq's correct option and every translation's model answer is in the key.
    for (const lu of units) {
      for (const e of lu.unit.exercises) {
        if (e.type === 'mcq') expect(src.key).toContain(esc(e.options[e.answer]!));
        if (e.type === 'translate' || e.type === 'transform' || e.type === 'order') expect(src.key).toContain(esc(e.answers[0]!));
        if (e.type === 'gap') for (const a of e.answers) expect(src.key).toContain(esc(a[0]!));
      }
    }
  });

  it('adds the drills, the mock exams and a track list', () => {
    expect(src.stats.drills).toBeGreaterThan(0);
    expect(src.book).toContain('== Pronunciation drills');
    for (const x of exams) expect(src.book).toContain(esc(x.exam.title));
    expect(src.book).toContain('== Track list');
    expect(new Set(src.tracks.map((t) => t.id)).size).toBe(src.tracks.length);
    expect(src.book).toContain('https://oussamasegh.github.io/doppelpunkt/unit/a1-u01');
  });
});

// Compiles a small book with every exercise type and hostile text when a typst binary is at hand
// (PATH, TYPST_BIN or the cache that npm run book:build fills). Never downloads in tests.
const typst = findTypst({ download: false });
describe.skipIf(!typst || typst.kind !== 'cli')('typst compile', () => {
  it('compiles generated sources with special characters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-book-'));
    try {
      const unit = CompiledUnit.parse({
        id: 'a1-u01', level: 'A1', number: 1, title: `Hallo ${NASTY}`, titleEn: 'Hello', goal: 'Goal #1', canDo: ['I can $.'],
        intro: { scene: 'Scene *x*', dialogue: [{ speaker: 'Anna', text: 'Hallo <Tom>!', en: 'Hi // there' }] },
        grammar: [{ id: 'g', title: 'G_1', body: '**sein** is *irregular*:\n- *ich bin*\n- du bist\n\n1. Stock', tables: [[['A', 'B'], ['@x', '#y']]], commonMistakes: ['*a* → **b**'] }],
        reading: { title: 'R', text: 'Text [1]', en: 'Text' },
        swiss: { scene: 'Züri', dialogue: [{ speaker: 'Reto', text: 'Grüezi!', en: 'Hello!', variety: 'gsw-zh' }], notes: ['**Grüezi** = hello'] },
        vocab: [{ id: 'tisch', de: 'Tisch', en: 'table', pos: 'noun', gender: 'm', plural: 'Tische', gswZh: 'Tisch', example: { de: 'Der Tisch.', en: 'The table.' } }],
        exercises: ALL,
      });
      const exam = MockExam.parse({ id: 'a1-mock-1', level: 'A1', title: 'Mock', sections: [{ id: 'h1', skill: 'listening', title: 'Hören', minutes: 5, instructions: '*Hören*', stimulus: { text: 'Frau: Hallo' }, exercises: [ALL[0]] }] });
      const src = buildBookSources({ units: [{ level: 'A1', number: 1, dir: dir, unit }], drills: [], exams: [{ level: 'A1', file: '', dir: '', exam }], version: '1.0.0' });
      copyFileSync(TEMPLATE_FILE, join(dir, TEMPLATE_IMPORT));
      for (const [name, text] of [['book.typ', src.book], ['key.typ', src.key]] as const) {
        writeFileSync(join(dir, name), text);
        const out = join(dir, name.replace('.typ', '.pdf'));
        const r = compileTypst(typst!, join(dir, name), out, dir);
        expect(r.message).not.toMatch(/error/);
        expect(r.ok).toBe(true);
        expect(pdfPages(out)).toBeGreaterThan(1);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
