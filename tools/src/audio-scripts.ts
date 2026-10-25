// `npm run audio:scripts`: writes content/<level>/unit-NN/audio-manifest.json and audio-script.md
// for every unit that loads. Output is deterministic (content order, no timestamps).
// `--check` writes nothing and exits 1 when a file is missing or out of date (for CI).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, renderScript, type AudioManifest } from './audio';
import { buildExamManifest, EXAM_DIR, loadExams, renderExamScript, type ExamAudioManifest } from './exam';
import { formatIssues, repoRoot, unitFolder } from './lint';
import { loadContent } from './load';
import { buildPronunciationManifest, drillFiles, loadDrills, PRONUNCIATION_DIR, renderPronunciationScript, type PronunciationManifest } from './pronunciation';

export const MANIFEST_FILE = 'audio-manifest.json';
export const SCRIPT_FILE = 'audio-script.md';

export type ScriptsResult = { ok: boolean; manifests: AudioManifest[]; pronunciation?: PronunciationManifest; exams: ExamAudioManifest[]; changed: string[]; log: string };

export function exportScripts(contentDir: string, opts: { root?: string; check?: boolean } = {}): ScriptsResult {
  const root = opts.root ?? process.cwd();
  const loaded = loadContent(contentDir, root);
  const log: string[] = [];
  if (loaded.issues.some((i) => i.severity === 'error')) {
    log.push(formatIssues(loaded.issues.filter((i) => i.severity === 'error')), '\nUnits with errors are skipped. Run npm run content:lint.');
  }
  const manifests: AudioManifest[] = [];
  const changed: string[] = [];
  const emit = (files: Array<[string, string]>) => {
    for (const [path, body] of files) {
      const same = existsSync(path) && readFileSync(path, 'utf8') === body;
      if (same) continue;
      changed.push(relative(root, path) || path);
      if (!opts.check) writeFileSync(path, body);
    }
  };
  for (const lu of loaded.units) {
    const m = buildManifest(lu.unit, unitFolder(lu));
    manifests.push(m);
    emit([
      [join(lu.dir, MANIFEST_FILE), JSON.stringify(m, null, 2) + '\n'],
      [join(lu.dir, SCRIPT_FILE), renderScript(m)],
    ]);
    const linked = m.entries.filter((e) => e.referenced).length;
    log.push(`${m.folder}: ${m.entries.length} recording(s), ${linked} linked`);
  }

  // Pronunciation drills: one manifest and script for content/pronunciation/ (only when drill files exist).
  let pronunciation: PronunciationManifest | undefined;
  if (drillFiles(contentDir).length) {
    const pron = loadDrills(contentDir, root);
    if (pron.issues.some((i) => i.severity === 'error')) {
      log.push(formatIssues(pron.issues.filter((i) => i.severity === 'error')), '\nDrills with errors are skipped. Run npm run content:lint.');
    }
    pronunciation = buildPronunciationManifest(pron.drills);
    const dir = join(contentDir, PRONUNCIATION_DIR);
    emit([
      [join(dir, MANIFEST_FILE), JSON.stringify(pronunciation, null, 2) + '\n'],
      [join(dir, SCRIPT_FILE), renderPronunciationScript(pronunciation)],
    ]);
    log.push(`${PRONUNCIATION_DIR}: ${pronunciation.drills.length} drill(s), ${pronunciation.entries.length} recording(s), ${pronunciation.entries.filter((e) => e.referenced).length} linked`);
  }
  // Mock exams: one manifest and script per level in content/<level>/exam/ (only when exam files exist).
  const exams: ExamAudioManifest[] = [];
  const ex = loadExams(contentDir, root);
  if (ex.issues.some((i) => i.severity === 'error')) {
    log.push(formatIssues(ex.issues.filter((i) => i.severity === 'error')), '\nExams with errors are skipped. Run npm run content:lint.');
  }
  for (const level of [...new Set(ex.exams.map((e) => e.level))]) {
    const m = buildExamManifest(level, ex.exams);
    exams.push(m);
    const dir = join(contentDir, level.toLowerCase(), EXAM_DIR);
    emit([
      [join(dir, MANIFEST_FILE), JSON.stringify(m, null, 2) + '\n'],
      [join(dir, SCRIPT_FILE), renderExamScript(m)],
    ]);
    log.push(`${m.folder}: ${m.exams.length} exam(s), ${m.entries.length} recording(s), ${m.entries.filter((e) => e.referenced).length} linked`);
  }
  if (opts.check && changed.length) log.push(`\nOut of date (run npm run audio:scripts):\n  ${changed.join('\n  ')}`);
  else if (changed.length) log.push(`\nwrote ${changed.length} file(s)`);
  const total = manifests.reduce((n, m) => n + m.entries.length, 0);
  log.push(`${manifests.length} unit(s), ${total} recording(s) in total`);
  return { ok: !(opts.check && changed.length), manifests, ...(pronunciation ? { pronunciation } : {}), exams, changed, log: log.join('\n') };
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
