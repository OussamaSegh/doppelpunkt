import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintLexicons } from '../src/lexicon';
import { lintContent, repoRoot } from '../src/lint';
import { makeFixture, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const entry = { de: 'ich', gswZh: 'ich', gswBe: 'i', en: 'I', pos: 'pron', tags: ['pronouns'] };

describe('lexicon', () => {
  it('the real content/lexicon parses and validates without errors', () => {
    const r = lintLexicons(join(repoRoot, 'content'), repoRoot);
    expect(r.issues).toEqual([]);
    expect(r.files).toBeGreaterThanOrEqual(1);
    expect(r.entries).toBeGreaterThan(100);
  });

  it('accepts a valid lexicon and defaults tags', () => {
    f.write('lexicon/gsw-zh.yaml', { entries: [entry, { de: 'du', gswZh: 'du', en: 'you', pos: 'pron' }] });
    expect(lintLexicons(f.content, f.root)).toEqual({ files: 1, entries: 2, issues: [] });
  });

  it('reports schema errors with the entry headword', () => {
    f.write('lexicon/gsw-zh.yaml', { entries: [entry, { de: 'Haus', gswZh: '', en: 'house', pos: 'nomen', colour: 'red' }] });
    const msgs = lintLexicons(f.content, f.root).issues.map((i) => `${i.file} ${i.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^content\/lexicon\/gsw-zh\.yaml entries\[1\] \(de: Haus\) \.gswZh: must not be empty/),
      expect.stringMatching(/entries\[1\] \(de: Haus\) \.pos: Invalid enum value/),
      expect.stringMatching(/entries\[1\] \(de: Haus\).*Unrecognized key.*colour/),
    ]));
  });

  it('reports YAML syntax errors and duplicate headwords', () => {
    f.write('lexicon/a.yaml', 'entries:\n  - { de: [unclosed\n');
    f.write('lexicon/b.yaml', { entries: [entry, { ...entry, gswZh: 'i' }, { ...entry, pos: 'other' }] });
    const r = lintLexicons(f.content, f.root);
    expect(r.issues.some((i) => i.file.startsWith('content/lexicon/a.yaml:') && /^YAML:/.test(i.message))).toBe(true);
    expect(r.issues.filter((i) => /duplicate headword/.test(i.message)).map((i) => i.message)).toEqual([
      'entries[1] (de: ich): duplicate headword, same de and pos as entries[0]',
    ]);
  });

  it('is part of content:lint (errors fail the lint, entry count is reported)', () => {
    writeUnit(f, 'A1', 1);
    f.write('lexicon/gsw-zh.yaml', { entries: [entry] });
    const ok = lintContent(f.content, f.root);
    expect(ok.errors).toBe(0);
    expect(ok.info).toContain('lexicon: 1 entry in 1 file(s)');
    f.write('lexicon/gsw-zh.yaml', { words: [] });
    expect(lintContent(f.content, f.root).errors).toBeGreaterThan(0);
  });
});
