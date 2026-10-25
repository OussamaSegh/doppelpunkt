// Pack builder: `npm run content:build`. Lints the content, then compiles each level present into
// apps/web/public/packs/<level>.json plus index.json (PackIndex). Output is deterministic:
// units are sorted by number, keys follow the schema order, and builtAt comes from
// SOURCE_DATE_EPOCH or the newest content file modification time (never "now").
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, LevelPack, PackIndex, PronunciationPack, type Level } from '@doppelpunkt/content-schema';
import { formatCoverage } from './audio';
import { audioGroups, cdnLayout, refKey, type AudioGroup, type AudioKeyMap } from './audio-assets';
import type { LoadedExam } from './exam';
import { formatIssues, isV1, lintContent, repoRoot } from './lint';
import { UNIT_FILES, type LoadedUnit } from './load';
import { PRONUNCIATION_DIR, type LoadedDrill } from './pronunciation';

export type BuildOptions = {
  contentDir: string;
  outDir: string;
  version: string;
  /** Override builtAt (ISO). */
  builtAt?: string;
  /** Root used for relative paths in messages. */
  root?: string;
  /**
   * Public base URL of the audio CDN (AUDIO_PUBLIC_BASE). When set, audio fields in the packs are
   * rewritten to content-hashed CDN URLs (upload first with npm run audio:upload) and no audio is
   * copied into <outDir>/audio. Otherwise audio is copied there as before.
   */
  audioBase?: string;
};

export type BuildResult = { ok: boolean; index: PackIndex; written: string[]; log: string; audio: string[] };

/** Copy the files of the given audio groups to <outDir>/audio/<rel>. Returns paths relative to outDir, sorted. */
function copyGroups(groups: AudioGroup[], outDir: string): string[] {
  const copied = new Set<string>();
  for (const g of groups) {
    for (const f of g.files) {
      const dest = join(outDir, 'audio', f.rel);
      if (copied.has(dest)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(f.src, dest);
      copied.add(dest);
    }
  }
  return [...copied].map((p) => p.slice(outDir.length + 1).split('\\').join('/')).sort();
}

/**
 * Copy every referenced audio file of units and exams (and its .opus sibling when present) to
 * <outDir>/audio/<level>/<unit or exam id>/<path>, matching audioUrl() in apps/web/src/content.ts.
 * The audio folder is rebuilt from scratch so removed recordings disappear.
 */
export function copyAudio(units: LoadedUnit[], outDir: string, exams: LoadedExam[] = []): string[] {
  rmSync(join(outDir, 'audio'), { recursive: true, force: true });
  return copyGroups(audioGroups(units, [], exams), outDir);
}

/**
 * Copy the audio referenced by pronunciation drills (and .opus siblings) to
 * <outDir>/audio/pronunciation/<id>/<path>. Call after copyAudio (which clears the audio folder).
 */
export function copyDrillAudio(drills: LoadedDrill[], outDir: string): string[] {
  return copyGroups(audioGroups([], drills), outDir);
}

const AUDIO_KEYS = new Set(['audio', 'gswZhAudio', 'gswBeAudio']);

/** Deep copy of `value` with every audio field that has a CDN URL replaced by it. */
export function rewriteAudio<T>(value: T, owner: string, urls: AudioKeyMap): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = AUDIO_KEYS.has(k) && typeof x === 'string' ? (urls.get(refKey(owner, x)) ?? x) : walk(x);
    }
    return out;
  };
  return walk(value) as T;
}

const mtime = (p: string) => (existsSync(p) ? Math.floor(statSync(p).mtimeMs / 1000) * 1000 : 0);

function epochTime(): string | undefined {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000).toISOString() : undefined;
}

function sourceTime(units: LoadedUnit[], exams: LoadedExam[] = []): string {
  const fixed = epochTime();
  if (fixed) return fixed;
  let newest = 0;
  for (const u of units) {
    for (const f of Object.values(UNIT_FILES)) newest = Math.max(newest, mtime(join(u.dir, f)));
  }
  for (const e of exams) newest = Math.max(newest, mtime(e.file));
  return new Date(newest).toISOString();
}

/** builtAt of the pronunciation pack: SOURCE_DATE_EPOCH or the newest drill file (epoch 0 when there are none). */
function drillTime(drills: LoadedDrill[]): string {
  return epochTime() ?? new Date(drills.reduce((n, d) => Math.max(n, mtime(d.file)), 0)).toISOString();
}

export const PRONUNCIATION_PACK = 'pronunciation.json';

/** The pronunciation pack: drills sorted by id, keys in schema order. */
export function pronunciationPack(drills: LoadedDrill[], version: string, builtAt?: string): PronunciationPack {
  const sorted = [...drills].sort((a, b) => a.drill.id.localeCompare(b.drill.id));
  return PronunciationPack.parse({ version, builtAt: builtAt ?? drillTime(sorted), drills: sorted.map((d) => d.drill) });
}

export function buildPacks(opts: BuildOptions): BuildResult {
  const root = opts.root ?? process.cwd();
  const lint = lintContent(opts.contentDir, root, { strictReview: isV1(opts.version) });
  const log: string[] = [];
  if (lint.issues.length) log.push(formatIssues(lint.issues));
  if (lint.errors) {
    log.push(`\nNot building packs: ${lint.errors} content error(s). Run npm run content:lint.`);
    return { ok: false, index: { packs: [] }, written: [], log: log.join('\n'), audio: [] };
  }

  mkdirSync(opts.outDir, { recursive: true });
  const written: string[] = [];
  const index: PackIndex = { packs: [] };
  const levels = LEVELS.filter((l) => lint.units.some((u) => u.level === l) || lint.exams.some((e) => e.level === l));

  // Audio: CDN URLs (AUDIO_PUBLIC_BASE) or copies next to the packs.
  const groups = audioGroups(lint.units, lint.drills, lint.exams);
  const cdn = opts.audioBase ? cdnLayout(groups, opts.audioBase) : undefined;
  const urls: AudioKeyMap = cdn?.urls ?? new Map();
  const lvl = (l: Level) => l.toLowerCase();

  for (const level of levels) {
    const units = lint.units.filter((u) => u.level === level).sort((a, b) => a.number - b.number);
    const exams = lint.exams.filter((e) => e.level === level).sort((a, b) => a.exam.id.localeCompare(b.exam.id));
    const builtAt = opts.builtAt ?? sourceTime(units, exams);
    const pack = LevelPack.parse({
      level, version: opts.version, builtAt,
      units: units.map((u) => rewriteAudio(u.unit, `${lvl(level)}/${u.unit.id}`, urls)),
      exams: exams.map((e) => rewriteAudio(e.exam, `${lvl(level)}/${e.exam.id}`, urls)),
    });
    const file = `${level.toLowerCase()}.json`;
    writeFileSync(join(opts.outDir, file), JSON.stringify(pack) + '\n');
    written.push(file);
    index.packs.push({ level, version: opts.version, file, units: pack.units.length });
    const examLine = pack.exams.length ? `, ${pack.exams.length} mock exam(s) with ${pack.exams.reduce((n, x) => n + x.sections.reduce((m, s) => m + s.exercises.length, 0), 0)} item(s)` : '';
    log.push(`${file}: ${pack.units.length} unit(s), ${pack.units.reduce((n, u) => n + u.exercises.length, 0)} exercise(s)${examLine}`);
  }

  // Remove packs of levels that no longer have content.
  for (const name of readdirSync(opts.outDir)) {
    const m = /^([a-c][12])\.json$/.exec(name);
    if (m && !levels.includes(m[1]!.toUpperCase() as Level)) rmSync(join(opts.outDir, name));
  }

  const drills = lint.drills.map((d) => ({ ...d, drill: rewriteAudio(d.drill, `${PRONUNCIATION_DIR}/${d.drill.id}`, urls) }));
  const pron = pronunciationPack(drills, opts.version, opts.builtAt);
  writeFileSync(join(opts.outDir, PRONUNCIATION_PACK), JSON.stringify(pron) + '\n');
  written.push(PRONUNCIATION_PACK);
  log.push(`${PRONUNCIATION_PACK}: ${pron.drills.length} drill(s), ${pron.drills.reduce((n, d) => n + d.pairs.length, 0)} minimal pair(s)`);

  rmSync(join(opts.outDir, 'audio'), { recursive: true, force: true });
  const audio = cdn ? [] : copyGroups(groups, opts.outDir);
  const coverageLine = `audio coverage: ${formatCoverage(lint.audio)}; pronunciation audio: ${formatCoverage(lint.drillAudio)}${lint.exams.length ? `; exam audio: ${formatCoverage(lint.examAudio)}` : ''}`;
  log.push(cdn
    ? `audio: ${urls.size} reference(s) point to ${opts.audioBase} (${cdn.objects.length} file(s); upload them with npm run audio:upload); ${coverageLine}`
    : `audio: ${audio.length} file(s) copied; ${coverageLine}`);

  const parsedIndex = PackIndex.parse(index);
  writeFileSync(join(opts.outDir, 'index.json'), JSON.stringify(parsedIndex, null, 2) + '\n');
  written.push('index.json');
  log.push(`index.json: ${parsedIndex.packs.length} pack(s), version ${opts.version}`);
  return { ok: true, index: parsedIndex, written, log: log.join('\n'), audio };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2)): number {
  const version = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
  const res = buildPacks({
    contentDir: resolve(argValue(argv, '--content') ?? join(repoRoot, 'content')),
    outDir: resolve(argValue(argv, '--out') ?? join(repoRoot, 'apps', 'web', 'public', 'packs')),
    version,
    root: repoRoot,
    ...(process.env.AUDIO_PUBLIC_BASE?.trim() ? { audioBase: process.env.AUDIO_PUBLIC_BASE.trim() } : {}),
  });
  console.log(res.log);
  return res.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
