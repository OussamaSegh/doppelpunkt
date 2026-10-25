import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExportDump, type FeedbackReport } from '@doppelpunkt/beta-schema';
import { loadCatalog, type Catalog } from '../src/beta-catalog';
import { makeSyntheticDump } from '../src/beta-fixture';
import {
  buildBetaReport, compareVersions, formatBetaReport, isoWeek, main, normaliseMessage, parseExport, weekStart, THRESHOLDS,
} from '../src/beta-report';
import { main as fixtureMain } from '../src/beta-fixture';
import { makeFixture, writeUnit, type Fixture } from './fixture';

const drill = {
  id: 'ue-u',
  title: 'ü vs u',
  explanation: 'Round your lips.',
  pairs: [[{ text: 'Mütter', en: 'mothers' }, { text: 'Mutter', en: 'mother' }]],
  words: [{ text: 'fünf', en: 'five' }],
  sentences: [{ text: 'Die Tür ist grün.', en: 'The door is green.' }],
};

const empty = (over: Partial<ExportDump> = {}): ExportDump => ({ generatedAt: '2026-11-02T00:00:00.000Z', feedback: [], stats: [], crashes: [], retention: [], ...over });

/** One stats upload with the given items: [id, attempts, buckets, seconds]. */
function batch(items: Array<[string, number, [number, number, number], number]>, contentVersion = '0.5.0'): ExportDump['stats'][number] {
  return { kind: 'stats', appVersion: '0.5.0', contentVersion, day: '2026-10-01', cohort: '2026-W40', items: items.map(([itemId, attempts, buckets, seconds]) => ({ itemId, attempts, buckets, seconds })) };
}
function fb(itemId: string, reason: FeedbackReport['reason'], n = 1, contentVersion = '0.5.0'): FeedbackReport[] {
  return Array.from({ length: n }, (_, i) => ({ kind: 'feedback' as const, appVersion: '0.5.0', contentVersion, itemId, unitId: itemId.split('-').slice(0, 2).join('-'), reason, at: `2026-10-0${1 + (i % 9)}T10:00:00.000Z` }));
}

describe('beta catalog', () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
    for (let n = 1; n <= 4; n++) writeUnit(f, 'A1', n);
    f.write('pronunciation/ue-u.yaml', drill);
  });
  afterEach(() => f.cleanup());

  it('lists unit exercises with file and line, and drill items with the app ids', () => {
    const c = loadCatalog(f.content, f.root);
    const mcq = c.items.get('a1-u3-mcq')!;
    expect(mcq).toMatchObject({ kind: 'unit', type: 'mcq', groupId: 'a1-u03', file: 'content/a1/unit-03/exercises.yaml', rank: 3 });
    expect(readFileSync(join(f.root, mcq.file), 'utf8').split('\n')[mcq.line! - 1]).toContain('id: a1-u3-mcq');
    const ids = [...c.items.keys()].filter((k) => k.includes('ue-u'));
    expect(ids).toEqual(['pron-ue-u-pair-0', 'pron-ue-u-pair-1', 'ue-u-mp-0-a', 'ue-u-mp-0-b', 'pron-ue-u-word-0', 'pron-ue-u-sentence-0']);
    expect(c.items.get('ue-u-mp-0-b')).toMatchObject({ type: 'minimal-pair', groupId: 'pron-ue-u', file: 'content/pronunciation/ue-u.yaml' });
    expect(c.groups.map((g) => g.id)).toEqual(['a1-u01', 'a1-u02', 'a1-u03', 'a1-u04', 'pron-ue-u']);
  });
});

describe('beta:report', () => {
  let f: Fixture;
  let catalog: Catalog;
  beforeEach(() => {
    f = makeFixture();
    for (let n = 1; n <= 4; n++) writeUnit(f, 'A1', n);
    catalog = loadCatalog(f.content, f.root);
  });
  afterEach(() => f.cleanup());

  it('handles an empty dump', () => {
    const r = buildBetaReport(empty(), catalog);
    expect(r.items).toEqual([]);
    expect(r.flagged).toEqual([]);
    expect(r.totals).toMatchObject({ contentItems: 28, seenItems: 0, attempts: 0, orphanIds: 0 });
    expect(r.exit.retention.status).toBe('no-data');
    expect(r.exit.wrong.status).toBe('no-data');
    expect(r.groups).toHaveLength(4);
    const md = formatBetaReport(r, { root: f.root });
    expect(md).toMatch(/Nothing flagged/);
    expect(md).toMatch(/No retention data yet/);
    expect(md).toMatch(/No crash reports/);
    expect(md).not.toMatch(/SYNTHETIC/);
  });

  it('computes facility, time and flag rate and applies the rules', () => {
    const dump = empty({
      stats: [
        batch([
          ['a1-u1-gap', 40, [30, 5, 5], 400], // facility (2.5 + 5) / 40 = 0.1875 -> too hard
          ['a1-u4-mcq', 40, [0, 0, 40], 400], // too easy after A1 unit 3
          ['a1-u2-mcq', 40, [0, 0, 40], 400], // easy but early: fine
          ['a1-u3-gap', 40, [0, 10, 30], 4000], // 100 s vs gap median -> slow
          ['a1-u2-gap', 40, [0, 10, 30], 400],
          ['a1-u4-gap', 40, [0, 10, 30], 440],
          ['a1-u1-mcq', 50, [5, 5, 40], 500], // 1 report in 50 = 2% -> often reported
        ]),
      ],
      feedback: [...fb('a1-u1-mcq', 'typo')],
    });
    const r = buildBetaReport(dump, catalog);
    const row = (id: string) => r.items.find((x) => x.itemId === id)!;
    expect(row('a1-u1-gap')).toMatchObject({ facility: 0.1875, secondsPerAttempt: 10, flags: ['too-hard'] });
    expect(row('a1-u4-mcq').flags).toEqual(['too-easy']);
    expect(row('a1-u2-mcq').flags).toEqual([]);
    expect(row('a1-u3-gap')).toMatchObject({ typeMedian: 10.5, flags: ['slow'] });
    expect(row('a1-u1-mcq')).toMatchObject({ flagRate: 0.02, flags: ['high-flag-rate'], wrong: false });
    expect(row('a1-u1-mcq').byReason.typo).toBe(1);
    expect(r.flagged.map((x) => x.itemId).sort()).toEqual(['a1-u1-gap', 'a1-u1-mcq', 'a1-u3-gap', 'a1-u4-mcq']);
    const u1 = r.groups.find((g) => g.id === 'a1-u01')!;
    expect(u1).toMatchObject({ items: 7, seen: 2, attempts: 90, feedback: 1, flagged: 2, wrong: 0 });
    const md = formatBetaReport(r, { root: f.root, linkBase: f.root });
    expect(md).toContain('[content/a1/unit-01/exercises.yaml:');
    expect(md).toMatch(/\]\(content\/a1\/unit-01\/exercises\.yaml#L\d+\)/);
  });

  it('does not judge small samples, except three wrong-answer reports', () => {
    const dump = empty({
      stats: [batch([
        ['a1-u4-gap', THRESHOLDS.minAttempts - 1, [29, 0, 0], 2900], // facility 0 but only 29 attempts
        ['a1-u4-mcq', 10, [0, 0, 10], 100],
        ['a1-u3-mcq', 10, [5, 5, 0], 100],
        ['a1-u2-mcq', 10, [5, 5, 0], 100],
        ['a1-u1-mcq', 40, [0, 0, 40], 400],
        ['a1-u1-gap', 40, [0, 0, 40], 400],
        ['a1-u2-gap', 40, [0, 0, 40], 400],
      ])],
      feedback: [...fb('a1-u4-mcq', 'unclear', 2), ...fb('a1-u3-mcq', 'wrong-answer', 2), ...fb('a1-u2-mcq', 'wrong-answer', 3)],
    });
    const r = buildBetaReport(dump, catalog);
    const row = (id: string) => r.items.find((x) => x.itemId === id)!;
    expect(row('a1-u4-gap').flags).toEqual([]);
    expect(row('a1-u4-mcq').flags).toEqual([]);
    expect(row('a1-u3-mcq')).toMatchObject({ flags: [], wrong: false });
    expect(row('a1-u2-mcq')).toMatchObject({ flags: ['high-flag-rate'], wrong: true });
    expect(r.flagged.map((x) => x.itemId)).toEqual(['a1-u2-mcq']);
    expect(r.exit.wrong).toMatchObject({ flagged: 1, seen: 7, status: 'not-met' });
  });

  it('lists ids that are not in the content as orphans', () => {
    const dump = empty({ stats: [batch([['a1-u1-old', 12, [1, 1, 10], 60], ['a1-u1-mcq', 5, [0, 0, 5], 25]])], feedback: [...fb('a1-u9-gone', 'typo')] });
    const r = buildBetaReport(dump, catalog);
    expect(r.orphans.map((o) => o.itemId)).toEqual(['a1-u1-old', 'a1-u9-gone']);
    expect(r.orphans[1]).toMatchObject({ feedback: 1, unitIds: ['a1-u9'] });
    expect(r.items.map((x) => x.itemId)).toEqual(['a1-u1-mcq']);
    expect(r.totals).toMatchObject({ orphanIds: 2, attempts: 17 });
    expect(formatBetaReport(r, { root: f.root })).toMatch(/## Unknown item ids[\s\S]*`a1-u1-old` \| 12/);
  });

  it('only counts stats and feedback from --since on', () => {
    const dump = empty({
      stats: [batch([['a1-u1-mcq', 40, [0, 0, 40], 400]], '0.5.0'), batch([['a1-u1-mcq', 40, [0, 0, 40], 400]], '0.5.1')],
      feedback: [...fb('a1-u1-mcq', 'wrong-answer', 3, '0.5.0'), ...fb('a1-u1-mcq', 'typo', 1, '0.5.10')],
    });
    expect(buildBetaReport(dump, catalog).items[0]).toMatchObject({ attempts: 80, wrong: true });
    const r = buildBetaReport(dump, catalog, { since: '0.5.1' });
    expect(r.items[0]).toMatchObject({ attempts: 40, wrong: false, feedback: 1 });
    expect(r.exit.wrong.status).toBe('met');
  });

  it('computes week-4 retention over complete cohorts against the 35% target', () => {
    const dump = empty({
      generatedAt: '2026-10-20T00:00:00.000Z',
      retention: [
        { cohortWeek: '2026-W37', installs: 20, activeWeek: [15, 12, 9, 7] }, // starts 2026-09-07, complete on 10-12
        { cohortWeek: '2026-W36', installs: 20, activeWeek: [14, 10, 8, 7] },
        { cohortWeek: '2026-W40', installs: 10, activeWeek: [8, 0, 0, 0] }, // incomplete
      ],
    });
    const r = buildBetaReport(dump, catalog);
    expect(r.retention.cohorts.map((c) => [c.cohortWeek, c.mature])).toEqual([['2026-W36', true], ['2026-W37', true], ['2026-W40', false]]);
    expect(r.retention.week4).toEqual({ installs: 40, retained: 14, rate: 0.35 });
    expect(r.exit.retention.status).toBe('met');
    const md = formatBetaReport(r, { root: f.root });
    expect(md).toMatch(/2026-W40 \| 10 \| 80% \(8\) .* incomplete/);
    dump.retention[0]!.activeWeek[3] = 6;
    expect(buildBetaReport(dump, catalog).exit.retention.status).toBe('not-met');
  });

  it('groups crashes by normalised message', () => {
    const crash = (message: string, route = '/unit/:id', name = 'TypeError') => ({ kind: 'crash' as const, appVersion: '0.5.0', name, message, route, browser: 'Firefox 144', at: '2026-10-01T00:00:00.000Z' });
    const r = buildBetaReport(empty({ crashes: [crash('Quota exceeded (52428800 bytes)'), crash('Quota exceeded (1048576 bytes)', '/settings'), crash('Chunk 3fa9c0d1e2 failed'), crash('Quota exceeded (1 bytes)', '/x', 'RangeError')] }), catalog);
    expect(r.crashes.map((c) => [c.count, c.name, c.message])).toEqual([[2, 'TypeError', 'Quota exceeded (<n> bytes)'], [1, 'RangeError', 'Quota exceeded (<n> bytes)'], [1, 'TypeError', 'Chunk <id> failed']]);
    expect(r.crashes[0]!.routes).toEqual(['/settings', '/unit/:id']);
    expect(normaliseMessage("Cannot read properties of undefined (reading 'audio')")).toBe("Cannot read properties of undefined (reading 'audio')");
  });

  it('rejects an invalid export with readable errors', () => {
    const p = parseExport({ generatedAt: 'x', feedback: [{ kind: 'feedback' }], stats: [], crashes: [] });
    expect(p.dump).toBeUndefined();
    expect(p.errors.join('\n')).toMatch(/feedback\.0\.\w+/);
    expect(p.errors.join('\n')).toMatch(/retention/);
    writeFileSync(join(f.root, 'bad.json'), JSON.stringify({ hello: 1 }));
    const err = console.error;
    const errors: string[] = [];
    console.error = (m: string) => errors.push(m);
    try {
      expect(main(['--in', 'bad.json', '--content', f.content], f.root)).toBe(1);
      expect(main([], f.root)).toBe(2);
    } finally {
      console.error = err;
    }
    expect(errors[0]).toMatch(/not a valid export[\s\S]*generatedAt: Required/);
  });
});

describe('beta:fixture', () => {
  let f: Fixture;
  let catalog: Catalog;
  beforeEach(() => {
    f = makeFixture();
    for (let n = 1; n <= 12; n++) writeUnit(f, 'A1', n);
    f.write('pronunciation/ue-u.yaml', drill);
    catalog = loadCatalog(f.content, f.root);
  });
  afterEach(() => f.cleanup());

  it('is deterministic, valid and marked synthetic', () => {
    const a = makeSyntheticDump(catalog, { learners: 80 });
    const b = makeSyntheticDump(catalog, { learners: 80 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(makeSyntheticDump(catalog, { learners: 80, seed: 'other' }))).not.toBe(JSON.stringify(a));
    expect(ExportDump.safeParse(a).success).toBe(true);
    expect(a.synthetic).toBe(true);
    expect(a.note).toMatch(/SYNTHETIC/);
    expect(a.stats.every((s) => s.appVersion.includes('synthetic'))).toBe(true);
    expect(a.retention.reduce((n, c) => n + c.installs, 0)).toBe(80);
  });

  it('plants problems that the report finds, and none in small samples', () => {
    const dump = makeSyntheticDump(catalog, { learners: 80 });
    const parsed = parseExport(JSON.parse(JSON.stringify(dump)));
    expect(parsed.synthetic).toBe(true);
    const r = buildBetaReport(parsed.dump!, catalog, { synthetic: true });
    const row = (id?: string) => r.items.find((x) => x.itemId === id)!;
    const p = dump.planted;
    expect(row(p.wrong)).toMatchObject({ wrong: true });
    expect(row(p.wrong).flags).toContain('high-flag-rate');
    expect(row(p.tooHard).flags).toContain('too-hard');
    expect(row(p.tooEasy).flags).toContain('too-easy');
    expect(row(p.slow).flags).toContain('slow');
    expect(row(p.smallSample).attempts).toBeLessThan(THRESHOLDS.minAttempts);
    expect(row(p.smallSample)).toMatchObject({ flags: [], wrong: false });
    expect(r.orphans.map((o) => o.itemId).sort()).toEqual([...p.orphans].sort());
    expect(r.crashes.map((c) => c.count)).toEqual([6, 3, 1]);
    expect(r.retention.cohorts.every((c) => c.mature)).toBe(true);
    expect(formatBetaReport(r, { root: f.root })).toMatch(/SYNTHETIC DATA/);
  });

  it('CLI: beta:fixture then beta:report writes Markdown and JSON', () => {
    const log = console.log;
    console.log = () => {};
    try {
      expect(fixtureMain(['--out', 'out/fixture.json', '--content', f.content], f.root)).toBe(0);
      expect(main(['--in', 'out/fixture.json', '--out', 'out/report.md', '--content', f.content], f.root)).toBe(0);
      expect(main(['--in', 'out/fixture.json', '--out', 'out/report.json', '--json', '--content', f.content], f.root)).toBe(0);
    } finally {
      console.log = log;
    }
    expect(existsSync(join(f.root, 'out/report.md'))).toBe(true);
    const md = readFileSync(join(f.root, 'out/report.md'), 'utf8');
    expect(md).toMatch(/^# Beta item report/);
    expect(md).toMatch(/## Exit criteria/);
    const json = JSON.parse(readFileSync(join(f.root, 'out/report.json'), 'utf8'));
    expect(json).toMatchObject({ synthetic: true, exit: { wrong: { target: 0.01 }, retention: { target: 0.35 } } });
  });
});

describe('beta helpers', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0);
    expect(compareVersions('0.5.0-synthetic', '0.5.0')).toBe(0);
    expect(compareVersions('0.5', '0.5.1')).toBeLessThan(0);
  });
  it('converts ISO weeks', () => {
    expect(weekStart('2026-W01')!.toISOString().slice(0, 10)).toBe('2025-12-29');
    expect(weekStart('2026-W37')!.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(weekStart('2026-09-08')!.toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(weekStart('nonsense')).toBeNull();
    expect(isoWeek(new Date('2026-09-07T12:00:00Z'))).toBe('2026-W37');
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});
