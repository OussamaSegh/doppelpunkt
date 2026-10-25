// `npm run audio:process -- --in <raw folder> [--unit a1/unit-01] [--force]`
// Takes raw recordings named after the manifest (dialog-intro-03.wav, vocab-hallo.flac, ...),
// trims leading/trailing silence, loudness-normalises to EBU R128 -16 LUFS mono (two-pass
// loudnorm), and encodes content/<level>/unit-NN/audio/<name>.mp3 (64 kbps) and .opus (32 kbps).
// Needs ffmpeg (or FFMPEG=/path/to/ffmpeg). Without it the command prints a message and exits 0,
// so it never breaks CI. Not part of lint or build.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from './audio';
import { repoRoot, unitFolder } from './lint';
import { loadContent } from './load';
import { buildPronunciationManifest, loadDrills, PRONUNCIATION_DIR } from './pronunciation';
import { buildExamManifest, examAudioFolder, loadExams } from './exam';

export const RAW_EXTENSIONS = ['.wav', '.flac', '.aif', '.aiff', '.mp3', '.m4a', '.ogg', '.opus', '.webm'];
export const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 };

export function findFfmpeg(): string | undefined {
  const bin = process.env.FFMPEG || 'ffmpeg';
  const r = spawnSync(bin, ['-hide_banner', '-version'], { encoding: 'utf8' });
  return r.status === 0 ? bin : undefined;
}

/** Silence trim at both ends (keeps 150 ms), rumble filter, mono. */
const PRE = [
  'highpass=f=70',
  'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:start_silence=0.15',
  'areverse',
  'silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB:start_silence=0.25',
  'areverse',
].join(',');
const LN = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
const BITEXACT = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];

type Measured = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

function measure(ffmpeg: string, input: string): Measured {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', input, '-ac', '1', '-af', `${PRE},${LN}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed to read the file: ${(r.stderr || '').trim().split('\n').pop()}`);
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(r.stderr ?? '');
  if (!json) throw new Error('could not read loudness measurement from ffmpeg');
  const m = JSON.parse(json[0]) as Measured;
  if (!Number.isFinite(Number(m.input_i))) throw new Error('the recording is silent after trimming');
  return m;
}

/** Process one raw file into <outBase>.mp3 and <outBase>.opus. */
export function processFile(ffmpeg: string, input: string, outBase: string): void {
  const m = measure(ffmpeg, input);
  const af = `${PRE},${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  const args = [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-y', '-i', input,
    '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', ...BITEXACT, `${outBase}.mp3`,
    '-af', af, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'audio', ...BITEXACT, `${outBase}.opus`,
  ];
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${(r.stderr || '').trim().split('\n').pop()}`);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (RAW_EXTENSIONS.includes(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

export type ProcessOptions = { contentDir: string; inDir: string; unit?: string; force?: boolean; root?: string; ffmpeg?: string | null };
export type ProcessResult = { ok: boolean; skipped: boolean; processed: string[]; log: string };

export function processAudio(opts: ProcessOptions): ProcessResult {
  const root = opts.root ?? process.cwd();
  const log: string[] = [];
  const ffmpeg = opts.ffmpeg === null ? undefined : (opts.ffmpeg ?? findFfmpeg());
  if (!ffmpeg) {
    return {
      ok: true,
      skipped: true,
      processed: [],
      log: 'audio:process skipped: ffmpeg not found. Install ffmpeg (https://ffmpeg.org/download.html) or set FFMPEG=/path/to/ffmpeg.',
    };
  }
  if (!existsSync(opts.inDir)) return { ok: false, skipped: false, processed: [], log: `input folder ${opts.inDir} does not exist` };

  // file base name -> unit folders whose manifest lists it
  const units = loadContent(opts.contentDir, root).units;
  const owners = new Map<string, string[]>();
  const dirs = new Map<string, string>();
  for (const lu of units) {
    const folder = unitFolder(lu);
    dirs.set(folder, lu.dir);
    for (const e of buildManifest(lu.unit, folder).entries) {
      const b = e.file.replace(/\.mp3$/, '');
      owners.set(b, [...(owners.get(b) ?? []), folder]);
    }
  }
  // Pronunciation drills: folder pronunciation/<id>, processed into content/pronunciation/<id>/audio/.
  const drills = loadDrills(opts.contentDir, root).drills;
  for (const d of drills) dirs.set(`${PRONUNCIATION_DIR}/${d.drill.id}`, d.dir);
  for (const e of buildPronunciationManifest(drills).entries) {
    const b = e.file.replace(/\.mp3$/, '');
    owners.set(b, [...(owners.get(b) ?? []), `${PRONUNCIATION_DIR}/${e.drill}`]);
  }
  // Mock exams: folder <level>/exam/<id>, processed into content/<level>/exam/<id>/audio/.
  for (const le of loadExams(opts.contentDir, root).exams) {
    const folder = examAudioFolder(le);
    dirs.set(folder, le.dir);
    for (const e of buildExamManifest(le.level, [le]).entries) {
      const b = e.file.replace(/\.mp3$/, '');
      owners.set(b, [...(owners.get(b) ?? []), folder]);
    }
  }
  if (opts.unit && !dirs.has(opts.unit)) return { ok: false, skipped: false, processed: [], log: `unknown unit ${opts.unit} (expected e.g. a1/unit-01, a1/exam/<exam id> or pronunciation/<drill id>)` };

  const processed: string[] = [];
  let ok = true;
  for (const input of walk(opts.inDir)) {
    const rel = relative(opts.inDir, input).split(sep).join('/');
    const base = basename(input, extname(input));
    const fromPath = /(?:^|\/)([a-c][12]\/unit-\d{2}|[a-c][12]\/exam\/[a-z0-9-]+|pronunciation\/[a-z0-9-]+)\//.exec(rel)?.[1];
    const candidates = owners.get(base) ?? [];
    const folder = opts.unit ?? fromPath ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!candidates.length) {
      log.push(`skip ${rel}: "${base}" is not in any audio manifest (run npm run audio:scripts and check the name)`);
      continue;
    }
    if (!folder) {
      log.push(`skip ${rel}: "${base}" exists in ${candidates.join(', ')}; put it in a <level>/unit-NN/ (or <level>/exam/<id>/) subfolder or pass --unit`);
      continue;
    }
    if (!candidates.includes(folder)) {
      log.push(`skip ${rel}: "${base}" is not in the manifest of ${folder}`);
      continue;
    }
    const outDir = join(dirs.get(folder)!, 'audio');
    const outBase = join(outDir, base);
    const fresh = ['.mp3', '.opus'].every((x) => existsSync(outBase + x) && statSync(outBase + x).mtimeMs >= statSync(input).mtimeMs);
    if (fresh && !opts.force) {
      log.push(`up to date ${folder}/audio/${base}`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    try {
      processFile(ffmpeg, input, outBase);
      processed.push(`${folder}/audio/${base}`);
      log.push(`ok ${rel} -> ${folder}/audio/${base}.{mp3,opus}`);
    } catch (err) {
      ok = false;
      log.push(`error ${rel}: ${(err as Error).message}`);
    }
  }
  log.push(`${processed.length} file(s) processed${processed.length ? '; run npm run audio:link to write the audio fields' : ''}`);
  return { ok, skipped: false, processed, log: log.join('\n') };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv = process.argv.slice(2)): number {
  const inDir = argValue(argv, '--in') ?? (argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined);
  if (!inDir) {
    console.log('usage: npm run audio:process -- --in <raw recordings folder> [--unit a1/unit-01] [--force]');
    return 1;
  }
  const r = processAudio({
    contentDir: resolve(argValue(argv, '--content') ?? join(repoRoot, 'content')),
    inDir: resolve(inDir),
    unit: argValue(argv, '--unit'),
    force: argv.includes('--force'),
    root: repoRoot,
  });
  console.log(r.log);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
