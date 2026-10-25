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
  if (loaded.issues.some((i) => i.severity === 'error')) {
    log.push(formatIssues(loaded.issues.filter((i) => i.severity === 'error')), '\nUnits with errors are skipped.');
  }
  for (const lu of loaded.units) {
    const m = buildManifest(lu.unit, unitFolder(lu));
    const byFile = new Map<string, LinkChange[]>();
    for (const e of m.entries) {
      if (!e.source.pointer || e.referenced || !existsSync(join(lu.dir, e.path))) continue;
      if (e.current && !opts.force && (isRemote(e.current) || existsSync(join(lu.dir, e.current)))) {
        skipped.push(`${m.folder}/${e.source.file} ${e.source.pointer.join('.')}: keeps ${e.current} (use --force to replace with ${e.path})`);
        continue;
      }
      const c: LinkChange = { file: join(lu.dir, e.source.file), pointer: e.source.pointer, to: e.path, ...(e.current ? { from: e.current } : {}) };
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
