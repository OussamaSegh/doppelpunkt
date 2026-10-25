// `npm run content:report`: one row per unit with exercises per skill, Swiss items, native-review
// status, audio coverage and item-type counts. `--json` prints the rows as JSON instead.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, type ExerciseType, type Skill } from '@doppelpunkt/content-schema';
import { addCoverage, buildManifest, coverage, formatCoverage, type Coverage } from './audio';
import { formatIssues, isV1, lintContent, repoRoot, repoVersion, unitFolder } from './lint';
import { drillCoverage } from './pronunciation';

export type ReportRow = {
  unitId: string;
  folder: string;
  title: string;
  exercises: number;
  skills: Record<Skill, number>;
  /** Exercises in a Swiss variety (ch-std, gsw-zh, gsw-be). */
  swiss: number;
  vocab: number;
  review: { de?: string; ch?: string; date?: string; notes: number };
  audio: Coverage;
  /** Recordings in the manifest, including those without a YAML field yet. */
  recordings: number;
  types: Partial<Record<ExerciseType, number>>;
};

export type DrillRow = { id: string; title: string; level: string; variety: string; pairs: number; words: number; sentences: number; audio: Coverage };

export type Report = { rows: ReportRow[]; drills: DrillRow[]; total: Omit<ReportRow, 'unitId' | 'folder' | 'title' | 'review'> & { reviewed: number }; errors: number; log: string };

export function buildReport(contentDir: string, root = process.cwd()): Report {
  const lint = lintContent(contentDir, root, { strictReview: false });
  const rows: ReportRow[] = lint.units.map((lu) => {
    const u = lu.unit;
    const skills = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>;
    const types: Partial<Record<ExerciseType, number>> = {};
    for (const e of u.exercises) {
      skills[e.skill]++;
      types[e.type] = (types[e.type] ?? 0) + 1;
    }
    const m = buildManifest(u, unitFolder(lu));
    return {
      unitId: u.id,
      folder: unitFolder(lu),
      title: u.title,
      exercises: u.exercises.length,
      skills,
      swiss: u.exercises.filter((e) => e.variety !== 'de').length,
      vocab: u.vocab.length,
      review: { ...(u.review?.de ? { de: u.review.de } : {}), ...(u.review?.ch ? { ch: u.review.ch } : {}), ...(u.review?.date ? { date: u.review.date } : {}), notes: u.review?.notes.length ?? 0 },
      audio: coverage(m, lu.dir),
      recordings: m.entries.length,
      types,
    };
  });
  const total: Report['total'] = {
    exercises: 0, skills: Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>, swiss: 0, vocab: 0,
    audio: { recorded: 0, total: 0 }, recordings: 0, types: {}, reviewed: 0,
  };
  for (const r of rows) {
    total.exercises += r.exercises;
    total.swiss += r.swiss;
    total.vocab += r.vocab;
    total.recordings += r.recordings;
    total.audio = addCoverage(total.audio, r.audio);
    if (r.review.de && r.review.ch) total.reviewed++;
    for (const s of SKILLS) total.skills[s] += r.skills[s];
    for (const [t, n] of Object.entries(r.types) as Array<[ExerciseType, number]>) total.types[t] = (total.types[t] ?? 0) + n;
  }
  const drills: DrillRow[] = lint.drills.map(({ drill: d, ...ld }) => ({
    id: d.id, title: d.title, level: d.level, variety: d.variety,
    pairs: d.pairs.length, words: d.words.length, sentences: d.sentences.length,
    audio: drillCoverage({ ...ld, drill: d }),
  }));
  const log = lint.errors ? formatIssues(lint.issues.filter((i) => i.severity === 'error')) + '\nUnits with errors are not in the report.\n' : '';
  return { rows, drills, total, errors: lint.errors, log };
}

const SKILL_ABBR: Record<Skill, string> = { reading: 'read', listening: 'listen', speaking: 'speak', writing: 'write', vocabulary: 'vocab', grammar: 'gram' };
const types = (t: Partial<Record<ExerciseType, number>>) =>
  (Object.entries(t) as Array<[string, number]>).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ');
const reviewCell = (r: ReportRow['review']) => `de ${r.de ? 'yes' : '-'} / ch ${r.ch ? 'yes' : '-'}`;

function table(head: string[], body: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]!))).join('  ').trimEnd();
  return [line(head), line(w.map((n) => '-'.repeat(n))), ...body.map(line)].join('\n');
}

export function formatReport(r: Report, version = '0.0.0'): string {
  const head = ['unit', 'ex', ...SKILLS.map((s) => SKILL_ABBR[s]), 'swiss', 'words', 'review', 'audio', 'types'];
  const body = r.rows.map((x) => [
    x.unitId, String(x.exercises), ...SKILLS.map((s) => String(x.skills[s])), String(x.swiss), String(x.vocab),
    reviewCell(x.review), formatCoverage(x.audio), types(x.types),
  ]);
  if (r.rows.length > 1) {
    const t = r.total;
    body.push(['total', String(t.exercises), ...SKILLS.map((s) => String(t.skills[s])), String(t.swiss), String(t.vocab),
      `${t.reviewed}/${r.rows.length} signed off`, formatCoverage(t.audio), types(t.types)]);
  }
  let pron = '';
  if (r.drills.length) {
    const drillBody = r.drills.map((d) => [d.id, d.level, d.variety, String(d.pairs), String(d.words), String(d.sentences), formatCoverage(d.audio), d.title]);
    if (r.drills.length > 1) {
      const sum = (k: 'pairs' | 'words' | 'sentences') => String(r.drills.reduce((n, d) => n + d[k], 0));
      const audio = r.drills.reduce((c, d) => addCoverage(c, d.audio), { recorded: 0, total: 0 });
      drillBody.push(['total', '', '', sum('pairs'), sum('words'), sum('sentences'), formatCoverage(audio), `${r.drills.length} drills`]);
    }
    pron = '\n\nPronunciation drills\n' + table(['drill', 'level', 'variety', 'pairs', 'words', 'sentences', 'audio', 'title'], drillBody);
  }
  const notes = [
    '',
    `audio: recorded/needed recordings (manifest entries, see npm run audio:scripts and docs/AUDIO.md).`,
    `review: sign-off by a German (de) and a Swiss (ch) native reviewer; ${isV1(version) ? 'required' : 'required from v1.0'}.`,
  ];
  return r.log + table(head, body) + pron + '\n' + notes.join('\n');
}

export function main(argv = process.argv.slice(2)): number {
  const i = argv.indexOf('--content');
  const contentDir = resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : join(repoRoot, 'content'));
  const r = buildReport(contentDir, repoRoot);
  console.log(argv.includes('--json') ? JSON.stringify({ rows: r.rows, drills: r.drills, total: r.total }, null, 2) : formatReport(r, repoVersion()));
  return r.errors ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
