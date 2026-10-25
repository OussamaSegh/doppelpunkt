// `npm run beta:report -- --in export.json [--out report.md] [--json] [--since 0.5.1]`
// Reads a collector export (GET /v1/export, ExportDump in @doppelpunkt/beta-schema), joins the
// item statistics and feedback with the current content by item id, and prints what a content
// author should look at: items that are too hard, too easy, slow or often reported as wrong,
// ids that are no longer in the content, retention by cohort week, grouped crashes and the v0.5
// exit criteria (docs/ROADMAP.md, docs/BETA.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExportDump, FeedbackReport } from '@doppelpunkt/beta-schema';
import { loadCatalog, rankOf, type Catalog, type CatalogItem, type ItemKind } from './beta-catalog';
import { repoRoot, repoVersion } from './lint';

export type Reason = FeedbackReport['reason'];
export const REASONS = FeedbackReport.shape.reason.options as readonly Reason[];

export const THRESHOLDS = {
  /** Attempts an item needs before facility, flag rate and time rules apply. */
  minAttempts: 30,
  tooHard: 0.3,
  tooEasy: 0.95,
  /** "Too easy" only counts after this point in the course (A1 unit 3): early items are meant to be easy. */
  tooEasyAfterRank: rankOf('A1', 3),
  flagRate: 0.02,
  /** This many 'wrong-answer' reports flag an item whatever its attempts. */
  wrongReports: 3,
  /** Slow: seconds per attempt above this multiple of the median of the item's type. */
  slowFactor: 3,
  /** Items of a type (with enough attempts) needed for a type median. */
  minTypeItems: 3,
  retentionTarget: 0.35,
  wrongTarget: 0.01,
} as const;

/** First-try facility: bucket weights for [0, 0.5), [0.5, 0.8), [0.8, 1] (partial credit for the middle). */
export const BUCKET_WEIGHTS = [0, 0.5, 1] as const;

export type Flag = 'too-hard' | 'too-easy' | 'high-flag-rate' | 'slow';

export type ItemRow = {
  itemId: string;
  groupId: string;
  kind: ItemKind;
  type: string;
  skill: string;
  variety: string;
  level: string;
  file: string;
  line?: number;
  attempts: number;
  firstTries: number;
  buckets: [number, number, number];
  /** Weighted first-try score 0–1 (BUCKET_WEIGHTS), null without first tries. */
  facility: number | null;
  secondsPerAttempt: number | null;
  /** Median seconds per attempt of items of the same type (null when too few items). */
  typeMedian: number | null;
  feedback: number;
  byReason: Record<Reason, number>;
  /** feedback / attempts (null without attempts). */
  flagRate: number | null;
  /** Counts as "flagged as wrong" for the exit criterion. */
  wrong: boolean;
  flags: Flag[];
  comments: Array<{ reason: Reason; comment?: string; answer?: string; contentVersion: string }>;
};

export type OrphanRow = { itemId: string; attempts: number; feedback: number; unitIds: string[]; contentVersions: string[] };

export type GroupRow = {
  id: string;
  title: string;
  kind: ItemKind;
  file: string;
  items: number;
  seen: number;
  attempts: number;
  /** Facility over all first tries in the group. */
  facility: number | null;
  feedback: number;
  flagged: number;
  wrong: number;
};

export type CohortRow = { cohortWeek: string; installs: number; activeWeek: number[]; rates: Array<number | null>; mature: boolean };

export type CrashGroup = { name: string; message: string; count: number; appVersions: string[]; routes: string[]; browsers: string[]; first: string; last: string; example: string };

export type Status = 'met' | 'not-met' | 'no-data';

export type BetaReport = {
  synthetic: boolean;
  generatedAt: string;
  contentVersion: string;
  since?: string;
  thresholds: typeof THRESHOLDS;
  totals: { batches: number; feedback: number; crashes: number; contentItems: number; seenItems: number; attempts: number; orphanIds: number; flaggedItems: number };
  items: ItemRow[];
  flagged: ItemRow[];
  orphans: OrphanRow[];
  groups: GroupRow[];
  retention: { cohorts: CohortRow[]; week4: { installs: number; retained: number; rate: number | null }; target: number; status: Status };
  crashes: CrashGroup[];
  exit: {
    retention: { value: number | null; target: number; status: Status };
    wrong: { flagged: number; seen: number; value: number | null; target: number; status: Status };
  };
};

// ---------- helpers ----------

/** Compare dotted versions numerically ("0.10.0" > "0.9.1"); pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0]!.split('.').map((n) => Number(n) || 0);
  const pb = b.split(/[-+]/)[0]!.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export const facilityOf = (b: readonly number[]): number | null => {
  const n = b.reduce((a, x) => a + x, 0);
  return n ? b.reduce((a, x, i) => a + x * BUCKET_WEIGHTS[i]!, 0) / n : null;
};

/** Monday (UTC) of an ISO week "2026-W41", or the day itself for "2026-10-05". Null when unparseable. */
export function weekStart(cohortWeek: string): Date | null {
  const w = /^(\d{4})-?W(\d{2})$/.exec(cohortWeek);
  if (w) {
    const jan4 = new Date(Date.UTC(Number(w[1]), 0, 4));
    const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000;
    return new Date(monday + (Number(w[2]) - 1) * 7 * 86400000);
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(cohortWeek) ? new Date(`${cohortWeek}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** ISO week "YYYY-Www" of a date (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this week
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Crash message with the varying parts (numbers, hex ids, scrubbed placeholders) replaced so equal bugs group. */
export function normaliseMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\[(?:url|email|number|redacted)\]/gi, '<…>')
    .replace(/\d+(?:\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- build ----------

export type BuildOptions = { since?: string; synthetic?: boolean; contentVersion?: string };

export function buildBetaReport(dump: ExportDump, catalog: Catalog, opts: BuildOptions = {}): BetaReport {
  const T = THRESHOLDS;
  const keep = (v: string) => !opts.since || compareVersions(v, opts.since) >= 0;
  const stats = dump.stats.filter((s) => keep(s.contentVersion));
  const feedback = dump.feedback.filter((f) => keep(f.contentVersion));

  type Acc = { attempts: number; buckets: [number, number, number]; seconds: number; byReason: Record<Reason, number>; comments: ItemRow['comments']; unitIds: Set<string>; versions: Set<string> };
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { attempts: 0, buckets: [0, 0, 0], seconds: 0, byReason: Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<Reason, number>, comments: [], unitIds: new Set(), versions: new Set() };
      acc.set(id, a);
    }
    return a;
  };
  for (const b of stats) {
    for (const it of b.items) {
      const a = get(it.itemId);
      a.attempts += it.attempts;
      it.buckets.forEach((n, i) => (a.buckets[i as 0 | 1 | 2] += n));
      a.seconds += it.seconds;
      a.versions.add(b.contentVersion);
    }
  }
  for (const f of feedback) {
    const a = get(f.itemId);
    a.byReason[f.reason]++;
    a.unitIds.add(f.unitId);
    a.versions.add(f.contentVersion);
    if (f.comment || f.answer) a.comments.push({ reason: f.reason, ...(f.comment ? { comment: f.comment } : {}), ...(f.answer ? { answer: f.answer } : {}), contentVersion: f.contentVersion });
  }

  const items: ItemRow[] = [];
  const orphans: OrphanRow[] = [];
  for (const [id, a] of acc) {
    const total = REASONS.reduce((n, r) => n + a.byReason[r], 0);
    const c: CatalogItem | undefined = catalog.items.get(id);
    if (!c) {
      orphans.push({ itemId: id, attempts: a.attempts, feedback: total, unitIds: [...a.unitIds].sort(), contentVersions: [...a.versions].sort(compareVersions) });
      continue;
    }
    const wrongN = a.byReason['wrong-answer'];
    const enough = a.attempts >= T.minAttempts;
    items.push({
      itemId: id, groupId: c.groupId, kind: c.kind, type: c.type, skill: c.skill, variety: c.variety, level: c.level, file: c.file, ...(c.line ? { line: c.line } : {}),
      attempts: a.attempts, firstTries: a.buckets[0] + a.buckets[1] + a.buckets[2], buckets: a.buckets,
      facility: facilityOf(a.buckets),
      secondsPerAttempt: a.attempts ? a.seconds / a.attempts : null,
      typeMedian: null,
      feedback: total, byReason: a.byReason,
      flagRate: a.attempts ? total / a.attempts : null,
      wrong: wrongN >= T.wrongReports || (enough && wrongN / a.attempts >= T.flagRate),
      flags: [],
      comments: a.comments,
    });
  }

  // Type medians over items with enough attempts.
  const perType = new Map<string, number[]>();
  for (const r of items) if (r.attempts >= T.minAttempts && r.secondsPerAttempt !== null) perType.set(r.type, [...(perType.get(r.type) ?? []), r.secondsPerAttempt]);
  for (const r of items) {
    const xs = perType.get(r.type) ?? [];
    r.typeMedian = xs.length >= T.minTypeItems ? median(xs) : null;
    const c = catalog.items.get(r.itemId)!;
    const enough = r.attempts >= T.minAttempts;
    if (enough && r.facility !== null && r.facility < T.tooHard) r.flags.push('too-hard');
    if (enough && r.facility !== null && r.facility > T.tooEasy && c.rank > T.tooEasyAfterRank) r.flags.push('too-easy');
    if ((enough && (r.flagRate ?? 0) >= T.flagRate) || r.byReason['wrong-answer'] >= T.wrongReports) r.flags.push('high-flag-rate');
    if (enough && r.typeMedian && r.secondsPerAttempt !== null && r.secondsPerAttempt > T.slowFactor * r.typeMedian) r.flags.push('slow');
  }

  const groupPos = new Map(catalog.groups.map((g, i) => [g.id, i]));
  const order = (r: ItemRow) => groupPos.get(r.groupId) ?? 0;
  items.sort((a, b) => order(a) - order(b) || a.groupId.localeCompare(b.groupId) || (a.line ?? 0) - (b.line ?? 0) || a.itemId.localeCompare(b.itemId));
  orphans.sort((a, b) => b.attempts + b.feedback - (a.attempts + a.feedback) || a.itemId.localeCompare(b.itemId));
  const flagSeverity = (r: ItemRow) => (r.wrong ? 100 : 0) + r.flags.length * 10 + Math.min(9, r.feedback);
  const flagged = items.filter((r) => r.flags.length || r.wrong).sort((a, b) => flagSeverity(b) - flagSeverity(a) || order(a) - order(b) || a.itemId.localeCompare(b.itemId));

  // Groups (units, exams, drills).
  const inGroup = new Map<string, number>();
  for (const c of catalog.items.values()) inGroup.set(c.groupId, (inGroup.get(c.groupId) ?? 0) + 1);
  const groups: GroupRow[] = catalog.groups.map((g) => {
    const rows = items.filter((r) => r.groupId === g.id);
    const b: [number, number, number] = [0, 0, 0];
    rows.forEach((r) => r.buckets.forEach((n, i) => (b[i as 0 | 1 | 2] += n)));
    return {
      id: g.id, title: g.title, kind: g.kind, file: g.file, items: inGroup.get(g.id) ?? 0,
      seen: rows.filter((r) => r.attempts > 0).length,
      attempts: rows.reduce((n, r) => n + r.attempts, 0),
      facility: facilityOf(b),
      feedback: rows.reduce((n, r) => n + r.feedback, 0),
      flagged: rows.filter((r) => r.flags.length || r.wrong).length,
      wrong: rows.filter((r) => r.wrong).length,
    };
  });

  // Retention.
  const genAt = new Date(dump.generatedAt);
  const cohorts: CohortRow[] = [...dump.retention]
    .sort((a, b) => a.cohortWeek.localeCompare(b.cohortWeek))
    .map((c) => {
      const start = weekStart(c.cohortWeek);
      const mature = !start || Number.isNaN(genAt.getTime()) || start.getTime() + 35 * 86400000 <= genAt.getTime();
      return { cohortWeek: c.cohortWeek, installs: c.installs, activeWeek: c.activeWeek, rates: c.activeWeek.map((n) => (c.installs ? n / c.installs : null)), mature };
    });
  const matureC = cohorts.filter((c) => c.mature);
  const w4 = { installs: matureC.reduce((n, c) => n + c.installs, 0), retained: matureC.reduce((n, c) => n + (c.activeWeek[3] ?? 0), 0), rate: null as number | null };
  w4.rate = w4.installs ? w4.retained / w4.installs : null;
  const retStatus: Status = w4.rate === null ? 'no-data' : w4.rate >= T.retentionTarget ? 'met' : 'not-met';

  // Crashes.
  const crashMap = new Map<string, CrashGroup>();
  for (const c of dump.crashes) {
    const message = normaliseMessage(c.message);
    const key = `${c.name}\u0000${message}`;
    let g = crashMap.get(key);
    if (!g) {
      g = { name: c.name, message, count: 0, appVersions: [], routes: [], browsers: [], first: c.at, last: c.at, example: c.message };
      crashMap.set(key, g);
    }
    g.count++;
    if (!g.appVersions.includes(c.appVersion)) g.appVersions.push(c.appVersion);
    if (!g.routes.includes(c.route)) g.routes.push(c.route);
    if (!g.browsers.includes(c.browser)) g.browsers.push(c.browser);
    if (c.at < g.first) g.first = c.at;
    if (c.at > g.last) g.last = c.at;
  }
  const crashes = [...crashMap.values()].map((g) => ({ ...g, appVersions: g.appVersions.sort(compareVersions), routes: g.routes.sort(), browsers: g.browsers.sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.message.localeCompare(b.message));

  const seen = items.filter((r) => r.attempts > 0);
  const wrongSeen = items.filter((r) => r.wrong).length;
  const wrongValue = seen.length ? wrongSeen / seen.length : null;

  return {
    synthetic: opts.synthetic ?? false,
    generatedAt: dump.generatedAt,
    contentVersion: opts.contentVersion ?? '',
    ...(opts.since ? { since: opts.since } : {}),
    thresholds: THRESHOLDS,
    totals: {
      batches: stats.length, feedback: feedback.length, crashes: dump.crashes.length,
      contentItems: catalog.items.size, seenItems: seen.length,
      attempts: items.reduce((n, r) => n + r.attempts, 0) + orphans.reduce((n, r) => n + r.attempts, 0),
      orphanIds: orphans.length, flaggedItems: flagged.length,
    },
    items, flagged, orphans, groups,
    retention: { cohorts, week4: w4, target: T.retentionTarget, status: retStatus },
    crashes,
    exit: {
      retention: { value: w4.rate, target: T.retentionTarget, status: retStatus },
      wrong: { flagged: wrongSeen, seen: seen.length, value: wrongValue, target: T.wrongTarget, status: wrongValue === null ? 'no-data' : wrongValue < T.wrongTarget ? 'met' : 'not-met' },
    },
  };
}

// ---------- markdown ----------

const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(digits)}%`);
const num = (x: number | null, digits = 2) => (x === null ? '–' : x.toFixed(digits));
const secs = (x: number | null) => (x === null ? '–' : `${Math.round(x)} s`);
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const STATUS: Record<Status, string> = { met: 'met', 'not-met': '**not met**', 'no-data': 'no data yet' };

function mdTable(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

const FLAG_HELP: Record<Flag, string> = {
  'too-hard': 'too hard',
  'too-easy': 'too easy',
  'high-flag-rate': 'often reported',
  slow: 'slow',
};

/** Markdown for content authors. `linkBase` is the folder the links are relative to (the --out folder, or the repo root). */
export function formatBetaReport(r: BetaReport, opts: { root?: string; linkBase?: string } = {}): string {
  const root = opts.root ?? repoRoot;
  const base = opts.linkBase ?? root;
  const link = (file: string, line?: number) => {
    const href = relative(base, join(root, file)).split('\\').join('/') + (line ? `#L${line}` : '');
    return `[${file}${line ? `:${line}` : ''}](${href})`;
  };
  const T = r.thresholds;
  const out: string[] = [];
  out.push('# Beta item report', '');
  if (r.synthetic) out.push('> **SYNTHETIC DATA.** This export was generated by `npm run beta:fixture` for testing and demos. Do not act on it.', '');
  out.push(`Export generated ${r.generatedAt}; content ${r.contentVersion || '(unknown)'}${r.since ? `; only stats and feedback from content ${r.since} or later` : ''}.`, '');
  out.push(`${r.totals.batches} stats uploads, ${r.totals.attempts} attempts, ${r.totals.feedback} feedback reports, ${r.totals.crashes} crash reports. ` +
    `${r.totals.seenItems} of ${r.totals.contentItems} content items seen; ${r.totals.flaggedItems} flagged; ${r.totals.orphanIds} unknown ids.`, '');

  out.push('## Exit criteria (v0.5)', '');
  const ex = r.exit;
  out.push(mdTable(['criterion', 'target', 'now', 'status'], [
    ['4-week retention', `≥ ${pct(ex.retention.target)}`, ex.retention.value === null ? '–' : `${pct(ex.retention.value, 1)} (${r.retention.week4.retained}/${r.retention.week4.installs} installs, complete cohorts)`, STATUS[ex.retention.status]],
    ['items flagged as wrong', `< ${pct(ex.wrong.target)}`, ex.wrong.value === null ? '–' : `${pct(ex.wrong.value, 1)} (${ex.wrong.flagged}/${ex.wrong.seen} items seen)`, STATUS[ex.wrong.status]],
  ]), '');
  out.push(`"Flagged as wrong": ≥ ${T.wrongReports} 'wrong-answer' reports, or a 'wrong-answer' rate ≥ ${pct(T.flagRate)} with ≥ ${T.minAttempts} attempts. ` +
    'After fixing items, rerun with `--since <content version>` so that reports on the old wording no longer count.', '');

  out.push('## Items to look at', '');
  if (!r.flagged.length) out.push('Nothing flagged. Items with fewer than ' + T.minAttempts + ' attempts are not judged on facility, report rate or time.', '');
  else {
    out.push(`Most urgent first. Facility = weighted first-try score (buckets [0, 0.5) = 0, [0.5, 0.8) = 0.5, [0.8, 1] = 1). ` +
      `Rules: too hard < ${T.tooHard}, too easy > ${T.tooEasy} (after A1 unit 3), often reported ≥ ${pct(T.flagRate)} of attempts or ≥ ${T.wrongReports} 'wrong-answer', ` +
      `slow > ${T.slowFactor}× the median time of its type; all except the 'wrong-answer' count need ≥ ${T.minAttempts} attempts.`, '');
    out.push(mdTable(['item', 'file', 'type', 'flags', 'attempts', 'facility', 'time (type median)', 'reports'], r.flagged.map((x) => [
      `\`${x.itemId}\``, link(x.file, x.line), `${x.type} · ${x.variety}`,
      [...(x.wrong ? ['**wrong**'] : []), ...x.flags.filter((f) => !(x.wrong && f === 'high-flag-rate')).map((f) => FLAG_HELP[f])].join(', '),
      String(x.attempts), num(x.facility), `${secs(x.secondsPerAttempt)} (${secs(x.typeMedian)})`,
      x.feedback ? `${x.feedback} (${pct(x.flagRate, 1)}): ${REASONS.filter((k) => x.byReason[k]).map((k) => `${k} ${x.byReason[k]}`).join(', ')}` : '–',
    ])), '');
    const withComments = r.flagged.filter((x) => x.comments.length);
    if (withComments.length) {
      out.push('### What learners wrote', '');
      for (const x of withComments) {
        out.push(`- \`${x.itemId}\` (${link(x.file, x.line)})`);
        for (const c of x.comments.slice(0, 5)) {
          out.push(`  - ${c.reason}${c.comment ? `: "${cell(c.comment)}"` : ''}${c.answer ? ` (answered "${cell(c.answer)}")` : ''} [content ${c.contentVersion}]`);
        }
        if (x.comments.length > 5) out.push(`  - … ${x.comments.length - 5} more in the JSON report`);
      }
      out.push('');
    }
  }

  if (r.orphans.length) {
    out.push('## Unknown item ids', '');
    out.push('In the export but not in the current content: renamed or removed items, or an app build with other content. Rename back, or ignore once no learner is on the old content version.', '');
    out.push(mdTable(['item id', 'attempts', 'reports', 'unit (from reports)', 'content versions'], r.orphans.map((o) => [
      `\`${o.itemId}\``, String(o.attempts), String(o.feedback), o.unitIds.join(', ') || '–', o.contentVersions.join(', ') || '–',
    ])), '');
  }

  out.push('## Units', '');
  out.push(mdTable(['unit', 'title', 'file', 'items seen', 'attempts', 'facility', 'reports', 'flagged', 'wrong'], r.groups.map((g) => [
    g.id, g.title, link(g.file), `${g.seen}/${g.items}`, String(g.attempts), num(g.facility), String(g.feedback), String(g.flagged), String(g.wrong),
  ])), '');

  out.push('## Retention by cohort week', '');
  if (!r.retention.cohorts.length) out.push('No retention data yet.', '');
  else {
    out.push(mdTable(['cohort', 'installs', 'week 1', 'week 2', 'week 3', 'week 4', ''], r.retention.cohorts.map((c) => [
      c.cohortWeek, String(c.installs), ...c.rates.map((x, i) => `${pct(x)} (${c.activeWeek[i]})`), c.mature ? '' : 'incomplete',
    ])), '');
    out.push(`Week-4 retention over complete cohorts: ${pct(r.retention.week4.rate, 1)} (target ≥ ${pct(r.retention.target)}). Cohorts younger than 5 weeks are marked incomplete and left out.`, '');
  }

  out.push('## Crashes', '');
  if (!r.crashes.length) out.push('No crash reports.', '');
  else {
    out.push(mdTable(['count', 'error', 'versions', 'routes', 'browsers', 'last seen'], r.crashes.map((c) => [
      String(c.count), `${c.name}: ${c.message}`, c.appVersions.join(', '), c.routes.slice(0, 4).join(', ') + (c.routes.length > 4 ? ', …' : ''), c.browsers.slice(0, 3).join(', ') + (c.browsers.length > 3 ? ', …' : ''), c.last.slice(0, 10),
    ])), '');
  }
  out.push('See docs/BETA.md for the weekly routine and how to triage flagged items.');
  return out.join('\n') + '\n';
}

// ---------- CLI ----------

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Parse and validate an export; returns the dump or human-readable errors. `synthetic` comes from the fixture marker. */
export function parseExport(raw: unknown): { dump?: ExportDump; synthetic: boolean; errors: string[] } {
  const synthetic = !!raw && typeof raw === 'object' && (raw as { synthetic?: unknown }).synthetic === true;
  const p = ExportDump.safeParse(raw);
  if (!p.success) return { synthetic, errors: p.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).concat(p.error.issues.length > 20 ? [`… ${p.error.issues.length - 20} more`] : []) };
  return { dump: p.data, synthetic, errors: [] };
}

export function main(argv = process.argv.slice(2), cwd = process.env.INIT_CWD ?? process.cwd()): number {
  const inArg = argValue(argv, '--in');
  if (!inArg) {
    console.error('usage: npm run beta:report -- --in export.json [--out report.md] [--json] [--since <content version>] [--content <dir>]');
    return 2;
  }
  const inFile = resolve(cwd, inArg);
  if (!existsSync(inFile)) {
    console.error(`beta:report: ${inFile} not found`);
    return 2;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inFile, 'utf8'));
  } catch (e) {
    console.error(`beta:report: ${inArg} is not JSON: ${(e as Error).message}`);
    return 1;
  }
  const parsed = parseExport(raw);
  if (!parsed.dump) {
    console.error(`beta:report: ${inArg} is not a valid export (ExportDump in @doppelpunkt/beta-schema):\n` + parsed.errors.map((e) => `  ${e}`).join('\n'));
    return 1;
  }
  const contentArg = argValue(argv, '--content');
  const contentDir = contentArg ? resolve(cwd, contentArg) : join(repoRoot, 'content');
  const since = argValue(argv, '--since');
  const report = buildBetaReport(parsed.dump, loadCatalog(contentDir, repoRoot), { synthetic: parsed.synthetic, contentVersion: repoVersion(), ...(since ? { since } : {}) });
  const outArg = argValue(argv, '--out');
  const json = argv.includes('--json');
  const outFile = outArg ? resolve(cwd, outArg) : undefined;
  const text = json ? JSON.stringify(report, null, 2) + '\n' : formatBetaReport(report, { root: repoRoot, linkBase: outFile ? dirname(outFile) : cwd });
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, text);
    const e = report.exit;
    console.log(`beta:report: wrote ${relative(cwd, outFile) || outFile}${report.synthetic ? ' (SYNTHETIC data)' : ''}`);
    console.log(`  ${report.totals.flaggedItems} flagged items, ${report.totals.orphanIds} unknown ids, ${report.crashes.length} crash groups`);
    console.log(`  retention week 4: ${pct(e.retention.value, 1)} (target ≥ 35%): ${e.retention.status}`);
    console.log(`  flagged as wrong: ${pct(e.wrong.value, 1)} (target < 1%): ${e.wrong.status}`);
  } else process.stdout.write(text);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
