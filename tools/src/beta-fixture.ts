// `npm run beta:fixture -- --out fixture.json [--seed s] [--learners 50]`
// Writes a deterministic, clearly SYNTHETIC collector export (ExportDump) built from the current
// content, for tests and demos of `npm run beta:report`. Same content + seed = same file.
// It simulates learners joining over three weeks and working through the units in order (so
// later units have fewer attempts), and plants known problems: a too-hard item, a too-easy item
// after A1 unit 3, an item reported as wrong, a slow item, ids that are no longer in the content,
// an item with reports but too few attempts to judge, and a few crashes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrashReport, ExportDump, FeedbackReport, ItemStat } from '@doppelpunkt/beta-schema';
import { loadCatalog, type Catalog, type CatalogItem } from './beta-catalog';
import { isoWeek } from './beta-report';
import { repoRoot, repoVersion } from './lint';

export const SYNTHETIC_APP_VERSION = '0.5.0-synthetic';
const DAY = 86400000;

/** Small deterministic PRNG (mulberry32) seeded by a string. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds per attempt by item type, before noise. */
const BASE_SECONDS: Record<string, number> = {
  mcq: 15, gap: 25, match: 40, order: 35, transform: 30, translate: 45, dictation: 50,
  speak: 20, roleplay: 120, write: 300, 'minimal-pair': 8,
};

export type Planted = {
  tooHard?: string; tooEasy?: string; wrong?: string; slow?: string; smallSample?: string; orphans: string[];
};

export type FixtureOptions = {
  seed?: string;
  learners?: number;
  /** First day of the beta (UTC, YYYY-MM-DD). */
  start?: string;
  /** Length of the simulated beta in weeks; the export is generated at its end. */
  weeks?: number;
  contentVersion?: string;
};

export type SyntheticDump = ExportDump & { synthetic: true; note: string; planted: Planted };

const iso = (t: number) => new Date(t).toISOString();
const dayOf = (t: number) => iso(t).slice(0, 10);

export function makeSyntheticDump(catalog: Catalog, opts: FixtureOptions = {}): SyntheticDump {
  const seed = opts.seed ?? 'doppelpunkt-beta';
  const learners = opts.learners ?? 50;
  const weeks = opts.weeks ?? 8;
  const start = Date.parse(`${opts.start ?? '2026-09-07'}T00:00:00Z`);
  const end = start + weeks * 7 * DAY;
  const contentVersion = opts.contentVersion ?? '0.5.0';
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

  const all = [...catalog.items.values()];
  const units = catalog.groups.filter((g) => g.kind === 'unit');
  const byGroup = new Map<string, CatalogItem[]>();
  for (const it of all) byGroup.set(it.groupId, [...(byGroup.get(it.groupId) ?? []), it]);
  const exams = catalog.groups.filter((g) => g.kind === 'exam');
  const drills = catalog.groups.filter((g) => g.kind === 'drill');

  // Planted items: chosen by position so they are stable for the same content.
  const inUnit = (i: number, type?: string) => (byGroup.get(units[i]?.id ?? '') ?? []).filter((x) => !type || x.type === type);
  const slow = inUnit(0, 'gap')[0]?.itemId ?? inUnit(0)[2]?.itemId;
  const planted: Planted = {
    wrong: (inUnit(0, 'mcq')[1] ?? inUnit(0).find((x) => x.itemId !== slow))?.itemId,
    slow,
    tooHard: inUnit(1, 'mcq')[2]?.itemId ?? inUnit(1)[2]?.itemId,
    tooEasy: inUnit(3, 'mcq')[0]?.itemId ?? inUnit(3)[0]?.itemId,
    smallSample: inUnit(Math.max(0, units.length - 2))[0]?.itemId,
    orphans: units[0] ? [`${units[0].id}-mcq-old-greeting`, `${units[0].id}-gap-removed`] : [],
  };
  const facilityTarget = (it: CatalogItem) => {
    if (it.itemId === planted.tooHard) return 0.1;
    if (it.itemId === planted.tooEasy) return 1.3;
    if (it.itemId === planted.smallSample) return 0.05;
    return 0.55 + rand() * 0.35;
  };
  const target = new Map(all.map((it) => [it.itemId, facilityTarget(it)]));

  type Acc = Map<string, ItemStat>;
  const feedback: FeedbackReport[] = [];
  const stats: ExportDump['stats'] = [];
  const retention = new Map<string, { installs: number; activeWeek: number[] }>();

  const attempt = (acc: Acc, it: Pick<CatalogItem, 'itemId' | 'type'>, f: number) => {
    const s = acc.get(it.itemId) ?? { itemId: it.itemId, attempts: 0, buckets: [0, 0, 0], seconds: 0 };
    const score = Math.max(0, Math.min(1, f + (rand() - 0.5) * 0.7));
    const bucket = score < 0.5 ? 0 : score < 0.8 ? 1 : 2;
    s.buckets[bucket]++;
    const tries = bucket < 2 && rand() < 0.6 ? 2 : 1;
    s.attempts += tries;
    const slow = it.itemId === planted.slow ? 5 : 1;
    s.seconds += Math.round(((BASE_SECONDS[it.type] ?? 30) * slow * tries * (0.6 + rand() * 0.8)) / 5) * 5;
    acc.set(it.itemId, s);
  };
  const report = (t: number, it: { itemId: string; groupId: string }, reason: FeedbackReport['reason'], comment?: string, answer?: string) => {
    feedback.push({
      kind: 'feedback', appVersion: SYNTHETIC_APP_VERSION, contentVersion, itemId: it.itemId, unitId: it.groupId, reason,
      ...(comment ? { comment } : {}), ...(answer ? { answer } : {}), at: iso(t),
    });
  };

  for (let l = 0; l < learners; l++) {
    const joined = start + Math.floor(rand() * 21) * DAY + Math.floor(rand() * 20) * 3600000;
    const cohort = isoWeek(new Date(joined));
    const r = retention.get(cohort) ?? { installs: 0, activeWeek: [0, 0, 0, 0] };
    r.installs++;
    retention.set(cohort, r);
    const pace = 0.9 + rand() * 1.3; // units per active week
    const keep = 0.66 + rand() * 0.22; // chance to come back each week
    let unitIdx = 0;
    let progress = 0; // units "earned" so far, fractional
    let active = true;
    for (let w = 0; joined + w * 7 * DAY < end; w++) {
      if (w > 0) active = active && rand() < keep;
      if (!active) break;
      if (w >= 1 && w <= 4) r.activeWeek[w - 1]!++;
      const weekStart = joined + w * 7 * DAY;
      const days = 1 + Math.floor(rand() * 3);
      for (let d = 0; d < days; d++) {
        const t = weekStart + Math.floor((d * 7) / days) * DAY + Math.floor(rand() * 12) * 3600000;
        if (t >= end) break;
        const acc: Acc = new Map();
        progress += pace / days;
        for (; unitIdx < Math.floor(progress + 0.5) && unitIdx < units.length; unitIdx++) {
          for (const it of byGroup.get(units[unitIdx]!.id) ?? []) {
            if (rand() < 0.08 && it.itemId !== planted.tooEasy) continue; // skipped
            attempt(acc, it, target.get(it.itemId)!);
            if (rand() < 0.0005) report(t, it, pick(['typo', 'audio', 'unclear', 'other'] as const));
          }
        }
        // Old app builds still send the removed items for a while.
        if (w === 0 && d === 0 && l % 4 === 0) for (const id of planted.orphans) attempt(acc, { itemId: id, type: 'mcq' }, 0.7);
        if (unitIdx >= units.length - 2 && exams.length && rand() < 0.4) {
          for (const it of byGroup.get(pick(exams).id) ?? []) attempt(acc, it, target.get(it.itemId)!);
        }
        if (drills.length && rand() < 0.3) {
          for (const it of byGroup.get(pick(drills).id) ?? []) attempt(acc, it, target.get(it.itemId)!);
        }
        if (!acc.size) continue;
        const items = [...acc.values()];
        for (let i = 0; i < items.length; i += 500) {
          stats.push({ kind: 'stats', appVersion: SYNTHETIC_APP_VERSION, contentVersion, band: unitIdx > units.length / 2 ? 'A1+' : 'A1', day: dayOf(t), items: items.slice(i, i + 500), cohort });
        }
      }
    }
  }

  // Planted feedback.
  const t0 = start + 9 * DAY;
  const item = (id?: string) => (id ? catalog.items.get(id) : undefined);
  const wrong = item(planted.wrong);
  if (wrong) {
    report(t0, wrong, 'wrong-answer', 'synthetic: my answer should be accepted too', 'synthetic answer');
    report(t0 + DAY, wrong, 'wrong-answer', 'synthetic: the marked solution looks wrong');
    report(t0 + 2 * DAY, wrong, 'wrong-answer');
    report(t0 + 3 * DAY, wrong, 'wrong-answer', undefined, 'synthetic answer');
    report(t0 + 3 * DAY, wrong, 'swiss-form', 'synthetic: in Zürich we say it differently');
  }
  const small = item(planted.smallSample);
  if (small) {
    report(t0 + 20 * DAY, small, 'wrong-answer', 'synthetic: small sample, should not be flagged');
    report(t0 + 21 * DAY, small, 'unclear');
  }
  if (units[0] && planted.orphans[0]) report(start + DAY, { itemId: planted.orphans[0], groupId: units[0].id }, 'typo', 'synthetic: report on a removed item');

  // Crashes: the same bugs with varying numbers, so that grouping can be checked.
  const crashes: CrashReport[] = [];
  const browsers = ['Safari 18 iOS', 'Chrome 141 Android', 'Firefox 144', 'Chrome 141'] as const;
  const crash = (t: number, name: string, message: string, route: string) =>
    crashes.push({ kind: 'crash', appVersion: SYNTHETIC_APP_VERSION, name, message, stack: `${name}: ${message}\n    at index-synthetic.js:1:${1000 + crashes.length}`, route, browser: pick(browsers), at: iso(t) });
  for (let i = 0; i < 6; i++) crash(start + (3 + i * 4) * DAY, 'TypeError', "Cannot read properties of undefined (reading 'audio')", i % 2 ? '/unit/:id' : '/pronunciation/:id');
  for (let i = 0; i < 3; i++) crash(start + (10 + i * 7) * DAY, 'QuotaExceededError', `The quota has been exceeded (${52428800 + i * 1048576} bytes)`, '/settings');
  crash(start + 30 * DAY, 'NotAllowedError', 'Permission denied by user agent after 2 attempts', '/unit/:id');

  feedback.sort((a, b) => a.at.localeCompare(b.at));
  stats.sort((a, b) => a.day.localeCompare(b.day));
  crashes.sort((a, b) => a.at.localeCompare(b.at));
  return {
    synthetic: true,
    note: `SYNTHETIC export generated by npm run beta:fixture (seed "${seed}", ${learners} learners) for tests and demos. Not real learner data.`,
    planted,
    generatedAt: iso(end),
    feedback,
    stats,
    crashes,
    retention: [...retention.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohortWeek, x]) => ({ cohortWeek, ...x })),
  };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2), cwd = process.env.INIT_CWD ?? process.cwd()): number {
  const outArg = argValue(argv, '--out');
  if (!outArg) {
    console.error('usage: npm run beta:fixture -- --out fixture.json [--seed <text>] [--learners 50] [--start 2026-09-07] [--weeks 8] [--content <dir>]');
    return 2;
  }
  const contentArg = argValue(argv, '--content');
  const contentDir = contentArg ? resolve(cwd, contentArg) : join(repoRoot, 'content');
  const learners = argValue(argv, '--learners');
  const weeks = argValue(argv, '--weeks');
  const dump = makeSyntheticDump(loadCatalog(contentDir, repoRoot), {
    contentVersion: repoVersion(),
    ...(argValue(argv, '--seed') ? { seed: argValue(argv, '--seed')! } : {}),
    ...(learners ? { learners: Number(learners) } : {}),
    ...(weeks ? { weeks: Number(weeks) } : {}),
    ...(argValue(argv, '--start') ? { start: argValue(argv, '--start')! } : {}),
  });
  const outFile = resolve(cwd, outArg);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(dump, null, 2) + '\n');
  const attempts = dump.stats.reduce((n, b) => n + b.items.reduce((m, i) => m + i.attempts, 0), 0);
  console.log(`beta:fixture: wrote SYNTHETIC export ${relative(cwd, outFile) || outFile}: ${dump.retention.reduce((n, c) => n + c.installs, 0)} installs, ` +
    `${dump.stats.length} stats uploads, ${attempts} attempts, ${dump.feedback.length} reports, ${dump.crashes.length} crashes`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
