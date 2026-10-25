// Content linter: `npm run content:lint`. Validates the YAML with the zod schemas, then checks
// the editorial rules below. Exits 1 when there is at least one error (warnings never fail).
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, type Level } from '@doppelpunkt/content-schema';
import { addCoverage, audioRefs, buildManifest, coverage, formatCoverage, isRemote, type Coverage } from './audio';
import { lintExams, loadExams, type LoadedExam } from './exam';
import { lintLexicons } from './lexicon';
import { loadContent, UNIT_FILES, type Issue, type LoadedUnit } from './load';
import { lintDrills, loadDrills, type LoadedDrill } from './pronunciation';
import { exerciseRules, listeningRules } from './rules';

export { countGaps } from './rules';

export type ReviewStatus = { unitId: string; de: boolean; ch: boolean };
export type LintResult = {
  issues: Issue[];
  errors: number;
  warnings: number;
  units: LoadedUnit[];
  levels: Level[];
  /** Recorded audio slots over all slots that have a YAML audio field (see audio.ts). */
  audio: Coverage;
  review: ReviewStatus[];
  /** Pronunciation drills that loaded (content/pronunciation/*.yaml), sorted by id. */
  drills: LoadedDrill[];
  /** Audio coverage of the drills (every pair word, word and sentence is a slot). */
  drillAudio: Coverage;
  /** Mock exams that loaded (content/<level>/exam/*.yaml), sorted by level and id. */
  exams: LoadedExam[];
  /** Audio coverage of the exams (listening stimuli and recorded items). */
  examAudio: Coverage;
  /** Summary lines printed after the issues (never fail the lint). */
  info: string[];
};

export type LintOptions = {
  /** Missing native-review sign-off becomes a warning per unit (from v1.0 on). Before that it is an info summary. */
  strictReview?: boolean;
};

/** Folder of a unit relative to content/, e.g. "a1/unit-01". */
export const unitFolder = (lu: Pick<LoadedUnit, 'level' | 'number'>) => `${lu.level.toLowerCase()}/unit-${String(lu.number).padStart(2, '0')}`;

/** Lint everything under `contentDir`. `root` is used for relative paths in messages. */
export function lintContent(contentDir: string, root = process.cwd(), opts: LintOptions = {}): LintResult {
  const loaded = loadContent(contentDir, root);
  const issues: Issue[] = [...loaded.issues];
  const push = (severity: Issue['severity'], file: string, message: string) => issues.push({ severity, file, message });

  let audio: Coverage = { recorded: 0, total: 0 };
  const review: ReviewStatus[] = [];
  const byLevel = new Map<Level, LoadedUnit[]>();
  for (const lu of loaded.units) byLevel.set(lu.level, [...(byLevel.get(lu.level) ?? []), lu]);

  // Grammar ids known so far (lower levels first), for the reference check.
  const knownGrammar = new Set<string>();
  for (const lu of loaded.units) lu.unit.grammar.forEach((g) => knownGrammar.add(g.id));

  for (const [, units] of byLevel) {
    const seen = { unit: new Map<string, string>(), exercise: new Map<string, string>(), vocab: new Map<string, string>(), grammar: new Map<string, string>() };
    const dup = (kind: keyof typeof seen, id: string, file: string) => {
      const prev = seen[kind].get(id);
      if (prev) push('error', file, `duplicate ${kind} id "${id}" (also in ${prev})`);
      else seen[kind].set(id, file);
    };
    for (const lu of units) {
      const f = (name: string) => relative(root, join(lu.dir, name)) || name;
      const u = lu.unit;
      dup('unit', u.id, f(UNIT_FILES.unit));
      u.grammar.forEach((g) => dup('grammar', g.id, f(UNIT_FILES.unit)));
      u.vocab.forEach((v) => dup('vocab', v.id, f(UNIT_FILES.vocab)));
      u.exercises.forEach((e) => dup('exercise', e.id, f(UNIT_FILES.exercises)));

      u.exercises.forEach((ex, i) => {
        exerciseRules(ex, `[${i}]`, f(UNIT_FILES.exercises), push);
        // In a unit, "Listen to the intro / Swiss lane dialogue" items play the unit's dialogue.
        listeningRules(ex, /\bdialogue\b/i.test(ex.prompt), `[${i}]`, f(UNIT_FILES.exercises), push);
        for (const g of ex.grammar) {
          if (!knownGrammar.has(g)) push('warning', f(UNIT_FILES.exercises), `[${i}] (id: ${ex.id}): grammar "${g}" is not defined in any unit`);
        }
      });

      const skills = new Set(u.exercises.map((e) => e.skill));
      const missing = SKILLS.filter((s) => !skills.has(s));
      if (missing.length) push('warning', f(UNIT_FILES.exercises), `no exercise for skill(s): ${missing.join(', ')}`);
      if (!u.exercises.some((e) => e.variety === 'gsw-zh')) push('error', f(UNIT_FILES.exercises), 'the unit needs at least one exercise with variety gsw-zh (the Swiss lane)');

      u.vocab.forEach((v, i) => {
        if (v.pos !== 'noun' || v.pluralOnly) return;
        if (!v.gender) push('error', f(UNIT_FILES.vocab), `[${i}] (id: ${v.id}): noun "${v.de}" needs a gender (m, f or n)`);
        if (!v.plural) push('warning', f(UNIT_FILES.vocab), `[${i}] (id: ${v.id}): noun "${v.de}" has no plural (use plural: "-" if it has none)`);
      });

      const mcqs = u.exercises.filter((e) => e.type === 'mcq');
      if (mcqs.length >= 2 && mcqs.every((e) => e.answer === 0)) {
        push('warning', f(UNIT_FILES.exercises), `all ${mcqs.length} mcq items have answer: 0; vary the position of the correct option`);
      }

      for (const ref of audioRefs(u)) {
        if (!isRemote(ref.path) && !existsSync(join(lu.dir, ref.path))) push('warning', f(ref.file), `${ref.where}: audio file ${ref.path} does not exist yet`);
      }
      audio = addCoverage(audio, coverage(buildManifest(u, unitFolder(lu)), lu.dir));

      const rs = { unitId: u.id, de: Boolean(u.review?.de?.trim()), ch: Boolean(u.review?.ch?.trim()) };
      review.push(rs);
      if (opts.strictReview && (!rs.de || !rs.ch)) {
        const which = [!rs.de && 'review.de', !rs.ch && 'review.ch'].filter(Boolean).join(' and ');
        push('warning', f(UNIT_FILES.unit), `native review sign-off missing: ${which}`);
      }
    }
  }

  const lexicon = lintLexicons(contentDir, root);
  issues.push(...lexicon.issues);

  const pron = loadDrills(contentDir, root);
  const drillLint = lintDrills(pron.drills, root);
  issues.push(...pron.issues, ...drillLint.issues);
  const drills = [...pron.drills].sort((a, b) => a.drill.id.localeCompare(b.drill.id));

  const ex = loadExams(contentDir, root);
  const examLint = lintExams(ex.exams, loaded.units, knownGrammar, root);
  issues.push(...ex.issues, ...examLint.issues);
  const exams = [...ex.exams].sort((a, b) => a.level.localeCompare(b.level) || a.exam.id.localeCompare(b.exam.id));

  const info: string[] = [`audio coverage: ${formatCoverage(audio)}`];
  if (exams.length || ex.issues.length) info.push(`exams: ${exams.length} mock exam(s), audio coverage ${formatCoverage(examLint.audio)}`);
  if (drills.length || pron.issues.length) info.push(`pronunciation: ${drills.length} drill(s), audio coverage ${formatCoverage(drillLint.audio)}`);
  if (lexicon.files) info.push(`lexicon: ${lexicon.entries} entr${lexicon.entries === 1 ? 'y' : 'ies'} in ${lexicon.files} file(s)`);
  if (review.length) {
    const done = review.filter((r) => r.de && r.ch).length;
    const missDe = review.filter((r) => !r.de).map((r) => r.unitId);
    const missCh = review.filter((r) => !r.ch).map((r) => r.unitId);
    let line = `review sign-off: ${done}/${review.length} unit(s)`;
    if (missDe.length) line += `; missing review.de: ${missDe.join(', ')}`;
    if (missCh.length) line += `; missing review.ch: ${missCh.join(', ')}`;
    info.push(line);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { issues, errors, warnings: issues.length - errors, units: loaded.units, levels: loaded.levels, audio, review, drills, drillAudio: drillLint.audio, exams, examAudio: examLint.audio, info };
}

export function formatIssues(issues: Issue[]): string {
  const byFile = new Map<string, Issue[]>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  const lines: string[] = [];
  for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(file);
    for (const i of list) lines.push(`  ${i.severity === 'error' ? 'error  ' : 'warning'}  ${i.message}`);
  }
  return lines.join('\n');
}

export const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Version of the root package.json; from 1.0 on the review sign-off is enforced as warnings. */
export function repoVersion(): string {
  return (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
}
export const isV1 = (version: string) => Number(version.split('.')[0]) >= 1;

export function main(argv = process.argv.slice(2)): number {
  const contentDir = resolve(argValue(argv, '--content') ?? join(repoRoot, 'content'));
  const r = lintContent(contentDir, repoRoot, { strictReview: isV1(repoVersion()) });
  if (r.issues.length) console.log(formatIssues(r.issues));
  console.log(
    `\n${r.units.length} unit(s) in ${r.levels.length} level(s): ${r.errors} error(s), ${r.warnings} warning(s).`,
  );
  for (const line of r.info) console.log(line);
  return r.errors ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
