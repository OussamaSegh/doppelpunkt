import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countGaps, lintContent } from '../src/lint';
import { loadContent } from '../src/load';
import { exercises, makeFixture, vocab, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const messages = (r: ReturnType<typeof lintContent>, sev?: 'error' | 'warning') =>
  r.issues.filter((i) => !sev || i.severity === sev).map((i) => `${i.file} ${i.message}`);

describe('load', () => {
  it('builds compiled units with schema defaults, ignoring non-level folders', () => {
    writeUnit(f, 'A1', 1);
    writeUnit(f, 'A1', 2);
    f.write('lexicon/words.yaml', [{ any: 'thing' }]);
    const r = loadContent(f.content, f.root);
    expect(r.issues).toEqual([]);
    expect(r.levels).toEqual(['A1']);
    expect(r.units.map((u) => u.unit.id)).toEqual(['a1-u01', 'a1-u02']);
    const u = r.units[0]!.unit;
    expect(u.vocab[0]!.tags).toEqual([]);
    expect(u.exercises[0]!.variety).toBe('de');
    expect(u.grammar[0]!.tables).toEqual([]);
  });
  it('reports schema errors with file path and exercise id', () => {
    const ex = exercises('a1-u1');
    (ex[0] as Record<string, unknown>).options = ['only one'];
    writeUnit(f, 'A1', 1, { exercises: ex });
    const r = loadContent(f.content, f.root);
    expect(r.units).toEqual([]);
    expect(r.issues[0]).toMatchObject({ severity: 'error', file: 'content/a1/unit-01/exercises.yaml' });
    expect(r.issues[0]!.message).toMatch(/^\[0\] \(id: a1-u1-mcq\) options:/);
  });
  it('reports YAML syntax errors with a line number and missing files', () => {
    writeUnit(f, 'A1', 1);
    f.write('a1/unit-01/vocab.yaml', '- id: x\n  de: [unclosed\n');
    f.write('a1/unit-02/unit.yaml', 'id: a1-u02\n');
    const r = loadContent(f.content, f.root);
    const msgs = r.issues.map((i) => `${i.file} ${i.message}`);
    expect(msgs.some((m) => /^content\/a1\/unit-01\/vocab\.yaml:\d+:\d+ YAML:/.test(m))).toBe(true);
    expect(msgs).toContain('content/a1/unit-02/vocab.yaml file is missing');
  });
  it('checks that level and number match the folder', () => {
    writeUnit(f, 'A1', 1, { unit: { level: 'A2', number: 3 } });
    const msgs = loadContent(f.content, f.root).issues.map((i) => i.message);
    expect(msgs).toContain('level is A2 but the folder is a1/');
    expect(msgs).toContain('number is 3 but the folder is unit-01');
  });
});

describe('lint rules', () => {
  it('passes a clean unit with no errors', () => {
    writeUnit(f, 'A1', 1);
    const r = lintContent(f.content, f.root);
    expect(messages(r, 'error')).toEqual([]);
  });
  it('passes an empty content dir', () => {
    expect(lintContent(f.content, f.root).issues).toEqual([]);
  });
  it('finds duplicate ids across the level', () => {
    writeUnit(f, 'A1', 1);
    writeUnit(f, 'A1', 2, { exercises: exercises('a1-u1'), vocab });
    writeUnit(f, 'A1', 3, { vocab });
    const errs = messages(lintContent(f.content, f.root), 'error');
    expect(errs).toContain('content/a1/unit-02/exercises.yaml duplicate exercise id "a1-u1-mcq" (also in content/a1/unit-01/exercises.yaml)');
    expect(errs.some((e) => e.includes('duplicate vocab id "hallo"'))).toBe(true);
  });
  it('checks gaps, mcq index, order tokens and match pairs', () => {
    const base = { prompt: 'p', explanation: 'e', skill: 'grammar' };
    writeUnit(f, 'A1', 1, {
      exercises: [
        ...exercises('a1-u1'),
        { ...base, id: 'g2', type: 'gap', text: 'Ich ___ aus ___.', answers: [['komme']] },
        { ...base, id: 'g4', type: 'gap', text: 'Ich ____ hier.', answers: [['bin']] },
        { ...base, id: 'm1', type: 'mcq', options: ['a', 'b'], answer: 2 },
        { ...base, id: 'm2', type: 'mcq', options: ['Sie', 'sie'], answer: 0, rationales: ['x'] },
        { ...base, id: 'o1', type: 'order', tokens: ['Ich', 'bin', 'hier'], answers: ['Ich bin da.', 'Hier bin ich!'] },
        { ...base, id: 'p1', type: 'match', pairs: [['a', 'x'], ['a', 'y']] },
      ],
    });
    const r = lintContent(f.content, f.root);
    const errs = messages(r, 'error').join('\n');
    expect(errs).toMatch(/\[7\] \(id: g2\): text has 2 gap\(s\) \(___\) but answers has 1 entry/);
    expect(errs).toMatch(/\(id: g4\): write gaps as exactly three underscores/);
    expect(errs).toMatch(/\(id: m1\): answer index 2 is out of range/);
    expect(errs).not.toMatch(/\(id: m2\): options contain duplicates/);
    expect(errs).toMatch(/\(id: o1\): answers\[0\] "Ich bin da\." does not use exactly the tokens/);
    expect(errs).not.toMatch(/\(id: o1\): answers\[1\]/);
    expect(errs).toMatch(/\(id: p1\): left-hand items must be unique/);
    expect(messages(r, 'warning').join('\n')).toMatch(/\(id: m2\): rationales has 1 entries but there are 2 options/);
  });
  it('requires the grader to accept the stored solution', () => {
    const base = { prompt: 'p', explanation: 'e', skill: 'grammar' };
    writeUnit(f, 'A1', 1, {
      exercises: [...exercises('a1-u1'), { ...base, id: 'bad', type: 'gap', text: '___', answers: [['']] }],
    });
    expect(messages(lintContent(f.content, f.root), 'error').join('\n')).toMatch(/\(id: bad\): answers\[0\] contains an empty string/);
  });
  it('warns about missing skills and requires a gsw-zh exercise', () => {
    writeUnit(f, 'A1', 1, { exercises: exercises('a1-u1').slice(0, 2) });
    const r = lintContent(f.content, f.root);
    expect(messages(r, 'warning').join('\n')).toMatch(/no exercise for skill\(s\): listening, speaking, writing, vocabulary/);
    expect(messages(r, 'error').join('\n')).toMatch(/needs at least one exercise with variety gsw-zh/);
  });
  it('checks noun gender and plural, unknown grammar ids and audio files', () => {
    const ex = exercises('a1-u1');
    (ex[0] as Record<string, unknown>).grammar = ['nope'];
    (ex[1] as Record<string, unknown>).audio = 'audio/missing.mp3';
    f.write('a1/unit-01/audio/here.mp3', 'x');
    (ex[2] as Record<string, unknown>).audio = 'audio/here.mp3';
    writeUnit(f, 'A1', 1, {
      exercises: ex,
      vocab: [
        { id: 'tisch', de: 'Tisch', en: 'table', pos: 'noun' },
        { id: 'schweiz', de: 'Schweiz', en: 'Switzerland', pos: 'noun', gender: 'f' },
      ],
    });
    const r = lintContent(f.content, f.root);
    expect(messages(r, 'error')).toContain('content/a1/unit-01/vocab.yaml [0] (id: tisch): noun "Tisch" needs a gender (m, f or n)');
    const warns = messages(r, 'warning').join('\n');
    expect(warns).toMatch(/\(id: schweiz\): noun "Schweiz" has no plural/);
    expect(warns).toMatch(/grammar "nope" is not defined/);
    expect(warns).toMatch(/audio file audio\/missing\.mp3 does not exist yet/);
    expect(warns).not.toMatch(/here\.mp3/);
  });
  it('counts gaps', () => {
    expect(countGaps('a ___ b ___')).toBe(2);
    expect(countGaps('none')).toBe(0);
  });
});
