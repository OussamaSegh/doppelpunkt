// Pack builder: `npm run content:build`. Lints the content, then compiles each level present into
// apps/web/public/packs/<level>.json plus index.json (PackIndex). Output is deterministic:
// units are sorted by number, keys follow the schema order, and builtAt comes from
// SOURCE_DATE_EPOCH or the newest content file modification time (never "now").
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, LevelPack, PackIndex, type Level } from '@doppelpunkt/content-schema';
import { audioRefs, formatCoverage, isRemote } from './audio';
import { formatIssues, isV1, lintContent, repoRoot } from './lint';
import { UNIT_FILES, type LoadedUnit } from './load';

export type BuildOptions = {
  contentDir: string;
  outDir: string;
  version: string;
  /** Override builtAt (ISO). */
  builtAt?: string;
  /** Root used for relative paths in messages. */
  root?: string;
};

export type BuildResult = { ok: boolean; index: PackIndex; written: string[]; log: string; audio: string[] };

/**
 * Copy every referenced audio file (and its .opus sibling when present) to
 * <outDir>/audio/<level>/<unitId>/<path>, matching audioUrl() in apps/web/src/content.ts.
 * The audio folder is rebuilt from scratch so removed recordings disappear.
 */
export function copyAudio(units: LoadedUnit[], outDir: string): string[] {
  const audioOut = join(outDir, 'audio');
  rmSync(audioOut, { recursive: true, force: true });
  const copied = new Set<string>();
  for (const lu of units) {
    const base = join(audioOut, lu.level.toLowerCase(), lu.unit.id);
    for (const ref of audioRefs(lu.unit)) {
      const rel = normalize(ref.path);
      if (isRemote(ref.path) || rel.startsWith('..')) continue;
      const variants = [rel, rel.replace(/\.[a-z0-9]+$/i, '.opus')];
      for (const v of new Set(variants)) {
        const src = join(lu.dir, v);
        const dest = join(base, v);
        if (!existsSync(src) || copied.has(dest)) continue;
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        copied.add(dest);
      }
    }
  }
  return [...copied].map((p) => p.slice(outDir.length + 1)).sort();
}

function sourceTime(units: LoadedUnit[]): string {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString();
  let newest = 0;
  for (const u of units) {
    for (const f of Object.values(UNIT_FILES)) {
      const p = join(u.dir, f);
      if (existsSync(p)) newest = Math.max(newest, Math.floor(statSync(p).mtimeMs / 1000) * 1000);
    }
  }
  return new Date(newest).toISOString();
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
  const levels = LEVELS.filter((l) => lint.units.some((u) => u.level === l));

  for (const level of levels) {
    const units = lint.units.filter((u) => u.level === level).sort((a, b) => a.number - b.number);
    const builtAt = opts.builtAt ?? sourceTime(units);
    const pack = LevelPack.parse({ level, version: opts.version, builtAt, units: units.map((u) => u.unit) });
    const file = `${level.toLowerCase()}.json`;
    writeFileSync(join(opts.outDir, file), JSON.stringify(pack) + '\n');
    written.push(file);
    index.packs.push({ level, version: opts.version, file, units: pack.units.length });
    log.push(`${file}: ${pack.units.length} unit(s), ${pack.units.reduce((n, u) => n + u.exercises.length, 0)} exercise(s)`);
  }

  // Remove packs of levels that no longer have content.
  for (const name of readdirSync(opts.outDir)) {
    const m = /^([a-c][12])\.json$/.exec(name);
    if (m && !levels.includes(m[1]!.toUpperCase() as Level)) rmSync(join(opts.outDir, name));
  }

  const audio = copyAudio(lint.units, opts.outDir);
  log.push(`audio: ${audio.length} file(s) copied; audio coverage: ${formatCoverage(lint.audio)}`);

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
  });
  console.log(res.log);
  return res.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
