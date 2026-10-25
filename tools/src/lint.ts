// Content linter: `npm run content:lint`. Validates the YAML with the zod schemas, then checks
// the editorial rules below. Exits 1 when there is at least one error (warnings never fail).
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, type CompiledUnit, type Exercise, type Level } from '@doppelpunkt/content-schema';
import { grade, normalize, sentenceKey, type Answer } from '@doppelpunkt/engine';
import { loadContent, UNIT_FILES, type Issue, type LoadedUnit } from './load';

export type LintResult = { issues: Issue[]; errors: number; warnings: number; units: LoadedUnit[]; levels: Level[] };

/** Count of gap markers. A gap is exactly three underscores. */
export function countGaps(text: string): number {
  return (text.match(/___/g) ?? []).length;
}

const words = (s: string) => sentenceKey(s).split(' ').filter(Boolean).sort().join(' ');

/** Answers that the grader must accept for an exercise (self-check of the stored solution). */
function modelAnswers(ex: Exercise): Answer[] {
  switch (ex.type) {
    case 'mcq': return [ex.answer];
    case 'gap': return [ex.answers.map((a) => a[0] ?? '')];
    case 'order': return ex.answers;
    case 'match': return [ex.pairs];
    case 'dictation': return [ex.transcript];
    case 'translate':
    case 'transform': return ex.answers;
    case 'speak': return [ex.target];
    case 'write':
    case 'roleplay': return [];
  }
}

function exerciseRules(ex: Exercise, where: string, file: string, push: (s: Issue['severity'], f: string, m: string) => void) {
  const at = `${where} (id: ${ex.id})`;
  switch (ex.type) {
    case 'gap': {
      const n = countGaps(ex.text);
      if (/_{4,}/.test(ex.text)) push('error', file, `${at}: write gaps as exactly three underscores (___)`);
      if (n !== ex.answers.length) push('error', file, `${at}: text has ${n} gap(s) (___) but answers has ${ex.answers.length} entr${ex.answers.length === 1 ? 'y' : 'ies'}`);
      ex.answers.forEach((a, i) => {
        if (a.some((s) => !s.trim())) push('error', file, `${at}: answers[${i}] contains an empty string`);
      });
      break;
    }
    case 'mcq':
      if (ex.answer >= ex.options.length) push('error', file, `${at}: answer index ${ex.answer} is out of range (${ex.options.length} options, indexes 0-${ex.options.length - 1})`);
      if (ex.rationales && ex.rationales.length !== ex.options.length) push('warning', file, `${at}: rationales has ${ex.rationales.length} entries but there are ${ex.options.length} options`);
      if (new Set(ex.options.map((o) => normalize(o, { caseSensitive: true }))).size !== ex.options.length) push('error', file, `${at}: options contain duplicates`);
      break;
    case 'order': {
      const expected = words(ex.tokens.join(' '));
      ex.answers.forEach((a, i) => {
        if (words(a) !== expected) push('error', file, `${at}: answers[${i}] "${a}" does not use exactly the tokens [${ex.tokens.join(' | ')}]`);
      });
      break;
    }
    case 'match': {
      const left = ex.pairs.map(([l]) => sentenceKey(l));
      const right = ex.pairs.map(([, r]) => sentenceKey(r));
      if (new Set(left).size !== left.length) push('error', file, `${at}: left-hand items must be unique`);
      if (new Set(right).size !== right.length) push('error', file, `${at}: right-hand items must be unique`);
      break;
    }
    case 'transform':
    case 'translate':
    case 'dictation':
    case 'speak':
    case 'write':
    case 'roleplay':
      break;
  }
  if ('answers' in ex && Array.isArray(ex.answers) && ex.type !== 'gap') {
    (ex.answers as string[]).forEach((a, i) => {
      if (!a.trim()) push('error', file, `${at}: answers[${i}] is empty`);
    });
  }
  // The stored solution must be accepted by the grader.
  for (const ans of modelAnswers(ex)) {
    let res;
    try {
      res = grade(ex, ans);
    } catch (e) {
      push('error', file, `${at}: grader crashed on the model answer: ${(e as Error).message}`);
      continue;
    }
    if (!res.correct) push('error', file, `${at}: the grader rejects the model answer ${JSON.stringify(ans)} (score ${res.score.toFixed(2)})`);
  }
}

function audioRefs(u: CompiledUnit): Array<{ file: string; path: string; where: string }> {
  const out: Array<{ file: string; path: string; where: string }> = [];
  u.intro.dialogue.forEach((l, i) => l.audio && out.push({ file: UNIT_FILES.unit, path: l.audio, where: `intro.dialogue[${i}]` }));
  u.swiss.dialogue.forEach((l, i) => l.audio && out.push({ file: UNIT_FILES.unit, path: l.audio, where: `swiss.dialogue[${i}]` }));
  u.vocab.forEach((v, i) => v.audio && out.push({ file: UNIT_FILES.vocab, path: v.audio, where: `[${i}] (id: ${v.id})` }));
  u.exercises.forEach((e, i) => e.audio && out.push({ file: UNIT_FILES.exercises, path: e.audio, where: `[${i}] (id: ${e.id})` }));
  return out;
}

/** Lint everything under `contentDir`. `root` is used for relative paths in messages. */
export function lintContent(contentDir: string, root = process.cwd()): LintResult {
  const loaded = loadContent(contentDir, root);
  const issues: Issue[] = [...loaded.issues];
  const push = (severity: Issue['severity'], file: string, message: string) => issues.push({ severity, file, message });

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

      for (const ref of audioRefs(u)) {
        if (!existsSync(join(lu.dir, ref.path))) push('warning', f(ref.file), `${ref.where}: audio file ${ref.path} does not exist yet`);
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  return { issues, errors, warnings: issues.length - errors, units: loaded.units, levels: loaded.levels };
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

export function main(argv = process.argv.slice(2)): number {
  const contentDir = resolve(argValue(argv, '--content') ?? join(repoRoot, 'content'));
  const r = lintContent(contentDir, repoRoot);
  if (r.issues.length) console.log(formatIssues(r.issues));
  console.log(
    `\n${r.units.length} unit(s) in ${r.levels.length} level(s): ${r.errors} error(s), ${r.warnings} warning(s).`,
  );
  return r.errors ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
