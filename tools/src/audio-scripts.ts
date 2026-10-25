// `npm run audio:scripts`: writes content/<level>/unit-NN/audio-manifest.json and audio-script.md
// for every unit that loads. Output is deterministic (content order, no timestamps).
// `--check` writes nothing and exits 1 when a file is missing or out of date (for CI).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, renderScript, type AudioManifest } from './audio';
import { formatIssues, repoRoot, unitFolder } from './lint';
import { loadContent } from './load';

export const MANIFEST_FILE = 'audio-manifest.json';
export const SCRIPT_FILE = 'audio-script.md';

export type ScriptsResult = { ok: boolean; manifests: AudioManifest[]; changed: string[]; log: string };

export function exportScripts(contentDir: string, opts: { root?: string; check?: boolean } = {}): ScriptsResult {
  const root = opts.root ?? process.cwd();
  const loaded = loadContent(contentDir, root);
  const log: string[] = [];
  if (loaded.issues.some((i) => i.severity === 'error')) {
    log.push(formatIssues(loaded.issues.filter((i) => i.severity === 'error')), '\nUnits with errors are skipped. Run npm run content:lint.');
  }
  const manifests: AudioManifest[] = [];
  const changed: string[] = [];
  for (const lu of loaded.units) {
    const m = buildManifest(lu.unit, unitFolder(lu));
    manifests.push(m);
    const files: Array<[string, string]> = [
      [join(lu.dir, MANIFEST_FILE), JSON.stringify(m, null, 2) + '\n'],
      [join(lu.dir, SCRIPT_FILE), renderScript(m)],
    ];
    for (const [path, body] of files) {
      const same = existsSync(path) && readFileSync(path, 'utf8') === body;
      if (same) continue;
      changed.push(relative(root, path) || path);
      if (!opts.check) writeFileSync(path, body);
    }
    const linked = m.entries.filter((e) => e.referenced).length;
    log.push(`${m.folder}: ${m.entries.length} recording(s), ${linked} linked`);
  }
  if (opts.check && changed.length) log.push(`\nOut of date (run npm run audio:scripts):\n  ${changed.join('\n  ')}`);
  else if (changed.length) log.push(`\nwrote ${changed.length} file(s)`);
  const total = manifests.reduce((n, m) => n + m.entries.length, 0);
  log.push(`${manifests.length} unit(s), ${total} recording(s) in total`);
  return { ok: !(opts.check && changed.length), manifests, changed, log: log.join('\n') };
}

export function main(argv = process.argv.slice(2)): number {
  const i = argv.indexOf('--content');
  const contentDir = resolve(i >= 0 && argv[i + 1] ? argv[i + 1]! : join(repoRoot, 'content'));
  const r = exportScripts(contentDir, { root: repoRoot, check: argv.includes('--check') });
  console.log(r.log);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
