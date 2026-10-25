// `npm run audio:link`: for every manifest entry whose processed file exists in
// content/<level>/unit-NN/audio/, write its `audio:` field into the unit YAML. Comments and
// formatting are preserved (see yaml-edit.ts). Fields an author set by hand to another existing
// file are left alone unless --force. `--dry-run` only reports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, isRemote } from './audio';
import { formatIssues, repoRoot, unitFolder } from './lint';
import { loadContent } from './load';
import { buildPronunciationManifest, loadDrills } from './pronunciation';
import { setYamlString } from './yaml-edit';

export type LinkChange = { file: string; pointer: Array<string | number>; from?: string; to: string };
export type LinkResult = { ok: boolean; changes: LinkChange[]; skipped: string[]; log: string };

export function linkAudio(contentDir: string, opts: { root?: string; dryRun?: boolean; force?: boolean } = {}): LinkResult {
  const root = opts.root ?? process.cwd();
  const loaded = loadContent(contentDir, root);
  const changes: LinkChange[] = [];
  const skipped: string[] = [];
  const log: string[] = [];
  let ok = true;
  const pron = loadDrills(contentDir, root);
  const errors = [...loaded.issues, ...pron.issues].filter((i) => i.severity === 'error');
  if (errors.length) log.push(formatIssues(errors), '\nUnits and drills with errors are skipped.');
  // One group per folder: entries, the folder audio paths are relative to, and the YAML file each fills.
  type Slot = { path: string; referenced: boolean; current?: string; pointer: Array<string | number> | null; base: string; yaml: string; label: string };
  const groups: Slot[][] = loaded.units.map((lu) => {
    const m = buildManifest(lu.unit, unitFolder(lu));
    return m.entries.map((e) => ({ ...e, pointer: e.source.pointer, base: lu.dir, yaml: join(lu.dir, e.source.file), label: `${m.folder}/${e.source.file}` }));
  });
  const entries = buildPronunciationManifest(pron.drills).entries;
  for (const d of pron.drills) {
    const label = relative(root, d.file) || d.file;
    groups.push(entries.filter((e) => e.drill === d.drill.id).map((e) => ({ ...e, pointer: e.source.pointer, base: d.dir, yaml: d.file, label })));
  }
  for (const entries of groups) {
    const byFile = new Map<string, LinkChange[]>();
    for (const e of entries) {
      if (!e.pointer || e.referenced || !existsSync(join(e.base, e.path))) continue;
      if (e.current && !opts.force && (isRemote(e.current) || existsSync(join(e.base, e.current)))) {
        skipped.push(`${e.label} ${e.pointer.join('.')}: keeps ${e.current} (use --force to replace with ${e.path})`);
        continue;
      }
      const c: LinkChange = { file: e.yaml, pointer: e.pointer, to: e.path, ...(e.current ? { from: e.current } : {}) };
      byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
    }
    for (const [file, list] of byFile) {
      let src = readFileSync(file, 'utf8');
      try {
        for (const c of list) src = setYamlString(src, c.pointer, c.to);
      } catch (err) {
        ok = false;
        log.push(`${relative(root, file)}: ${(err as Error).message}; file left unchanged`);
        continue;
      }
      if (!opts.dryRun) writeFileSync(file, src);
      changes.push(...list);
      log.push(`${relative(root, file)}: ${opts.dryRun ? 'would link' : 'linked'} ${list.length} file(s)`);
    }
  }
  if (skipped.length) log.push(...skipped);
  log.push(`${changes.length} audio field(s) ${opts.dryRun ? 'to write' : 'written'}`);
  return { ok, changes, skipped, log: log.join('\n') };
}

export function main(argv = process.argv.slice(2)): number {
  const i = argv.indexOf('--content');
  const contentDir = resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : join(repoRoot, 'content'));
  const r = linkAudio(contentDir, { root: repoRoot, dryRun: argv.includes('--dry-run'), force: argv.includes('--force') });
  console.log(r.log);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
