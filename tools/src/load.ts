// Reads content/<level>/unit-NN/{unit.yaml,vocab.yaml,exercises.yaml} and builds CompiledUnit objects.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { CompiledUnit, Exercise, LEVELS, Unit, VocabItem, type Level } from '@doppelpunkt/content-schema';

export type Severity = 'error' | 'warning';
export type Issue = { severity: Severity; file: string; message: string };

export type LoadedUnit = {
  level: Level;
  /** Folder number from unit-NN. */
  number: number;
  dir: string;
  unit: CompiledUnit;
};

export type LoadResult = { units: LoadedUnit[]; issues: Issue[]; levels: Level[] };

const UNIT_DIR = /^unit-(\d{2})$/;
export const UNIT_FILES = { unit: 'unit.yaml', vocab: 'vocab.yaml', exercises: 'exercises.yaml' } as const;

/** Level folders present (a1, a2, ...), in CEFR order. Other folders such as content/lexicon are ignored. */
export function levelDirs(contentDir: string): Array<{ level: Level; dir: string }> {
  if (!existsSync(contentDir)) return [];
  const names = new Set(readdirSync(contentDir));
  return LEVELS.filter((l) => names.has(l.toLowerCase()))
    .map((level) => ({ level, dir: join(contentDir, level.toLowerCase()) }))
    .filter((x) => statSync(x.dir).isDirectory());
}

export function unitDirs(levelDir: string): Array<{ number: number; dir: string }> {
  return readdirSync(levelDir)
    .map((name) => ({ m: UNIT_DIR.exec(name), name }))
    .filter((x): x is { m: RegExpExecArray; name: string } => x.m !== null)
    .map((x) => ({ number: Number(x.m[1]), dir: join(levelDir, x.name) }))
    .filter((x) => statSync(x.dir).isDirectory())
    .sort((a, b) => a.number - b.number);
}

/** Human-readable location for a zod issue path, e.g. `[3] (id: a1-u01-e4) .options`. */
export function describePath(path: Array<string | number>, data: unknown): string {
  if (!path.length) return '(root)';
  let out = '';
  let cur: unknown = data;
  path.forEach((seg, i) => {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
      cur = Array.isArray(cur) ? cur[seg] : undefined;
      if (i === 0 && cur && typeof cur === 'object' && 'id' in cur) out += ` (id: ${String((cur as { id: unknown }).id)})`;
    } else {
      out += (out ? (out.endsWith(')') ? ' ' : '.') : '') + seg;
      cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined;
    }
  });
  return out;
}

export function zodIssues(file: string, err: z.ZodError, data: unknown): Issue[] {
  return err.issues.map((iss) => ({
    severity: 'error' as const,
    file,
    message: `${describePath(iss.path, data)}: ${iss.message}`,
  }));
}

function readYaml(file: string, issues: Issue[], root: string): { ok: boolean; data: unknown } {
  const rel = relative(root, file) || file;
  if (!existsSync(file)) {
    issues.push({ severity: 'error', file: rel, message: 'file is missing' });
    return { ok: false, data: undefined };
  }
  const doc = parseDocument(readFileSync(file, 'utf8'), { prettyErrors: true });
  if (doc.errors.length) {
    for (const e of doc.errors) {
      const pos = e.linePos?.[0];
      issues.push({ severity: 'error', file: rel + (pos ? `:${pos.line}:${pos.col}` : ''), message: `YAML: ${e.message.split('\n')[0]}` });
    }
    return { ok: false, data: undefined };
  }
  return { ok: true, data: doc.toJS() };
}

/**
 * Load and schema-validate one unit folder. `root` is used only to print relative paths.
 * Returns the compiled unit when all three files validate.
 */
export function loadUnit(
  dir: string,
  expect: { level: Level; number: number },
  root = process.cwd(),
): { unit?: CompiledUnit; issues: Issue[] } {
  const issues: Issue[] = [];
  const rel = (f: string) => relative(root, join(dir, f)) || f;
  const u = readYaml(join(dir, UNIT_FILES.unit), issues, root);
  const v = readYaml(join(dir, UNIT_FILES.vocab), issues, root);
  const e = readYaml(join(dir, UNIT_FILES.exercises), issues, root);

  const unit = u.ok ? Unit.safeParse(u.data) : null;
  if (unit && !unit.success) issues.push(...zodIssues(rel(UNIT_FILES.unit), unit.error, u.data));
  const vocab = v.ok ? z.array(VocabItem).min(1, 'vocab.yaml needs at least one item').safeParse(v.data ?? []) : null;
  if (vocab && !vocab.success) issues.push(...zodIssues(rel(UNIT_FILES.vocab), vocab.error, v.data));
  const exercises = e.ok ? z.array(Exercise).min(1, 'exercises.yaml needs at least one exercise').safeParse(e.data ?? []) : null;
  if (exercises && !exercises.success) issues.push(...zodIssues(rel(UNIT_FILES.exercises), exercises.error, e.data));

  if (unit?.success) {
    if (unit.data.level !== expect.level) {
      issues.push({ severity: 'error', file: rel(UNIT_FILES.unit), message: `level is ${unit.data.level} but the folder is ${expect.level.toLowerCase()}/` });
    }
    if (unit.data.number !== expect.number) {
      issues.push({ severity: 'error', file: rel(UNIT_FILES.unit), message: `number is ${unit.data.number} but the folder is unit-${String(expect.number).padStart(2, '0')}` });
    }
  }
  if (!unit?.success || !vocab?.success || !exercises?.success) return { issues };
  const compiled = CompiledUnit.safeParse({ ...unit.data, vocab: vocab.data, exercises: exercises.data });
  if (!compiled.success) {
    issues.push(...zodIssues(relative(root, dir) || dir, compiled.error, undefined));
    return { issues };
  }
  return { unit: compiled.data, issues };
}

/** Load every unit of every level folder under `contentDir`. */
export function loadContent(contentDir: string, root = process.cwd()): LoadResult {
  const units: LoadedUnit[] = [];
  const issues: Issue[] = [];
  const levels: Level[] = [];
  for (const { level, dir } of levelDirs(contentDir)) {
    const list = unitDirs(dir);
    if (list.length) levels.push(level);
    for (const { number, dir: udir } of list) {
      const r = loadUnit(udir, { level, number }, root);
      issues.push(...r.issues);
      if (r.unit) units.push({ level, number, dir: udir, unit: r.unit });
    }
  }
  return { units, issues, levels };
}
