import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReport, formatReport } from '../src/report';
import { setYamlString, yamlScalar } from '../src/yaml-edit';
import { makeFixture, writeUnit, type Fixture } from './fixture';

describe('content:report', () => {
  let f: Fixture;
  beforeEach(() => { f = makeFixture(); });
  afterEach(() => f.cleanup());

  it('summarises skills, Swiss items, review, audio and types per unit', () => {
    writeUnit(f, 'A1', 1, { unit: { review: { de: 'K. Huber', ch: 'R. Meier' } } });
    writeUnit(f, 'A1', 2);
    const r = buildReport(f.content, f.root);
    expect(r.errors).toBe(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      unitId: 'a1-u01',
      folder: 'a1/unit-01',
      exercises: 7,
      skills: { reading: 1, listening: 1, speaking: 1, writing: 1, vocabulary: 2, grammar: 1 },
      swiss: 1,
      vocab: 2,
      review: { de: 'K. Huber', ch: 'R. Meier', notes: 0 },
      audio: { recorded: 0, total: 6 },
      types: { mcq: 1, gap: 1, order: 1, match: 1, dictation: 1, speak: 1, transform: 1 },
    });
    expect(r.total).toMatchObject({ exercises: 14, swiss: 2, reviewed: 1, audio: { recorded: 0, total: 12 } });
    const text = formatReport(r);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^unit\s+ex\s+read\s+listen\s+speak\s+write\s+vocab\s+gram\s+swiss\s+words\s+review\s+audio\s+types$/);
    expect(text).toMatch(/a1-u01\s+7\s+1\s+1\s+1\s+1\s+2\s+1\s+1\s+2\s+de yes \/ ch yes\s+0\/6 \(0%\)\s+dictation 1, gap 1/);
    expect(text).toMatch(/total\s+14 .* 1\/2 signed off/);
    expect(text).toMatch(/required from v1\.0/);
  });
});

describe('yaml-edit', () => {
  it('replaces an existing scalar in place', () => {
    const src = 'a: 1\nb: old # keep\nc: 3\n';
    expect(setYamlString(src, ['b'], 'new')).toBe('a: 1\nb: new # keep\nc: 3\n');
  });
  it('appends to a flow map', () => {
    const src = '- { speaker: Anna, text: "Hallo!" }   # line\n';
    expect(setYamlString(src, [0, 'audio'], 'audio/x.mp3')).toBe('- { speaker: Anna, text: "Hallo!", audio: audio/x.mp3 }   # line\n');
  });
  it('inserts after the last single-line entry, not inside a block scalar', () => {
    const src = 'items:\n  - id: a\n    type: gap\n    explanation: >-\n      long text\n      more\n\n  - id: b\n';
    const out = setYamlString(src, ['items', 0, 'audio'], 'audio/ex-a.mp3');
    expect(out).toBe('items:\n  - id: a\n    type: gap\n    audio: audio/ex-a.mp3\n    explanation: >-\n      long text\n      more\n\n  - id: b\n');
  });
  it('quotes values that are not plain-safe and refuses non-map parents', () => {
    expect(yamlScalar('audio/a.mp3')).toBe('audio/a.mp3');
    expect(yamlScalar('a: b')).toBe('"a: b"');
    expect(yamlScalar('true')).toBe('"true"');
    expect(() => setYamlString('- a\n- b\n', [0, 'audio'], 'x')).toThrow(/no map/);
  });
});
