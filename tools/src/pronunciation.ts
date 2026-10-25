// Pronunciation drills: content/pronunciation/<id>.yaml, one PronunciationDrill per file.
// Audio paths in a drill are relative to the drill's folder content/pronunciation/<id>/
// (e.g. `audio: audio/pron-ue-u-i-pair-01-a.mp3`), and the build copies them to
// apps/web/public/packs/audio/pronunciation/<id>/<path>, the same layout as unit audio.
// This module loads, lints, builds the manifest (audio:scripts / audio:link / audio:process)
// and computes audio coverage for drills.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { PronunciationDrill, type Variety } from '@doppelpunkt/content-schema';
import { gradeSpeech, normalize } from '@doppelpunkt/engine';
import { DELIVERY, isRemote, voiceFor, type AudioEntry, type Coverage, type Gender, type Voice } from './audio';
import { readYaml, zodIssues, type Issue } from './load';

export const PRONUNCIATION_DIR = 'pronunciation';
/** Prefix of every drill recording, and of the progress unit id (see engine drillUnitId). */
export const PRON_PREFIX = 'pron-';

export type LoadedDrill = {
  /** YAML file, absolute. */
  file: string;
  /** Folder that audio paths are relative to: content/pronunciation/<id>/. */
  dir: string;
  drill: PronunciationDrill;
};

const DRILL_FILE = /^([^.]+)\.ya?ml$/;
const KNOWN_KEYS = new Set(Object.keys(PronunciationDrill.shape));

/** Drill files under content/pronunciation (sorted by name). The audio manifest and script are not drills. */
export function drillFiles(contentDir: string): string[] {
  const dir = join(contentDir, PRONUNCIATION_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => DRILL_FILE.test(n) && statSync(join(dir, n)).isFile())
    .sort()
    .map((n) => join(dir, n));
}

/** Load and schema-validate every drill. File name must equal the id. */
export function loadDrills(contentDir: string, root = process.cwd()): { drills: LoadedDrill[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const drills: LoadedDrill[] = [];
  for (const file of drillFiles(contentDir)) {
    const rel = relative(root, file) || file;
    const y = readYaml(file, issues, root);
    if (!y.ok) continue;
    if (y.data && typeof y.data === 'object' && !Array.isArray(y.data)) {
      const unknown = Object.keys(y.data).filter((k) => !KNOWN_KEYS.has(k));
      if (unknown.length) issues.push({ severity: 'warning', file: rel, message: `unknown field(s) ignored: ${unknown.join(', ')} (known: ${[...KNOWN_KEYS].join(', ')})` });
    }
    const parsed = PronunciationDrill.safeParse(y.data);
    if (!parsed.success) {
      issues.push(...zodIssues(rel, parsed.error, y.data));
      continue;
    }
    const stem = DRILL_FILE.exec(basename(file))![1]!;
    if (parsed.data.id !== stem) {
      issues.push({ severity: 'error', file: rel, message: `id is "${parsed.data.id}" but the file is named ${basename(file)}; name the file ${parsed.data.id}.yaml` });
      continue;
    }
    drills.push({ file, dir: join(contentDir, PRONUNCIATION_DIR, parsed.data.id), drill: parsed.data });
  }
  return { drills, issues };
}

type Item = { text: string; en: string; audio?: string };

/** Every item of a drill with its location, file-name part and YAML pointer to its audio field. */
export function drillItems(d: PronunciationDrill): Array<{ item: Item; where: string; part: string; kind: 'pron-pair' | 'pron-word' | 'pron-sentence'; pointer: Array<string | number> }> {
  const pad = (n: number) => String(n + 1).padStart(2, '0');
  const out: ReturnType<typeof drillItems> = [];
  d.pairs.forEach((pair, i) => pair.forEach((item, side) => out.push({
    item, where: `pairs[${i}][${side}]`, part: `pair-${pad(i)}-${side === 0 ? 'a' : 'b'}`, kind: 'pron-pair', pointer: ['pairs', i, side, 'audio'],
  })));
  d.words.forEach((item, i) => out.push({ item, where: `words[${i}]`, part: `word-${pad(i)}`, kind: 'pron-word', pointer: ['words', i, 'audio'] }));
  d.sentences.forEach((item, i) => out.push({ item, where: `sentences[${i}]`, part: `sentence-${pad(i)}`, kind: 'pron-sentence', pointer: ['sentences', i, 'audio'] }));
  return out;
}

export type DrillLint = { issues: Issue[]; audio: Coverage };

/** Editorial rules for drills. Errors block the build; warnings never do. */
export function lintDrills(drills: LoadedDrill[], root = process.cwd()): DrillLint {
  const issues: Issue[] = [];
  const seen = new Map<string, string>();
  let audio: Coverage = { recorded: 0, total: 0 };
  for (const ld of drills) {
    const d = ld.drill;
    const file = relative(root, ld.file) || ld.file;
    const push = (severity: Issue['severity'], message: string) => issues.push({ severity, file, message });
    const prev = seen.get(d.id);
    if (prev) push('error', `duplicate drill id "${d.id}" (also in ${prev})`);
    else seen.set(d.id, file);

    if (!d.title.trim()) push('error', 'title is empty');
    if (!d.explanation.trim()) push('error', 'explanation is empty');
    if (!d.pairs.length) push('warning', 'no minimal pairs: the listening quiz needs at least one pair');

    const items = drillItems(d);
    for (const { item, where } of items) {
      if (!item.text.trim()) push('error', `${where}: text is empty`);
      if (!item.en.trim()) push('error', `${where}: en (English gloss) is empty`);
    }
    d.pairs.forEach(([a, b], i) => {
      if (a.text.trim() && normalize(a.text) === normalize(b.text)) push('error', `pairs[${i}]: "${a.text}" and "${b.text}" are the same word; a minimal pair needs two different words`);
    });
    // A pair the speaking grader cannot tell apart is useless for speaking practice.
    d.pairs.forEach(([a, b], i) => {
      if (!a.text.trim() || !b.text.trim() || normalize(a.text) === normalize(b.text)) return;
      if (gradeSpeech(a.text, b.text, { variety: d.variety }).correct || gradeSpeech(b.text, a.text, { variety: d.variety }).correct) {
        push('warning', `pairs[${i}]: the speech grader accepts "${a.text}" and "${b.text}" for each other, so saying the wrong word still passes`);
      }
    });
    const dupes = (list: Item[], name: string) => {
      const keys = new Map<string, number>();
      list.forEach((w, i) => {
        const k = normalize(w.text);
        if (!k) return;
        if (keys.has(k)) push('warning', `${name}[${i}]: "${w.text}" repeats ${name}[${keys.get(k)}]`);
        else keys.set(k, i);
      });
    };
    dupes(d.words, 'words');
    dupes(d.sentences, 'sentences');
    const pairKeys = new Map<string, number>();
    d.pairs.forEach(([a, b], i) => {
      const k = [normalize(a.text), normalize(b.text)].sort().join('|');
      if (pairKeys.has(k)) push('warning', `pairs[${i}]: repeats pairs[${pairKeys.get(k)}]`);
      else pairKeys.set(k, i);
    });

    // The speaking grader must accept each text read back verbatim (self-check like exercise solutions).
    for (const { item, where } of items) {
      if (!item.text.trim()) continue;
      const r = gradeSpeech(item.text, item.text, { variety: d.variety });
      if (!r.correct) push('error', `${where}: the speech grader rejects the text itself (${JSON.stringify(item.text)}, score ${r.score.toFixed(2)})`);
    }

    for (const { item, where } of items) {
      if (item.audio && !isRemote(item.audio) && !existsSync(join(ld.dir, item.audio))) {
        push('warning', `${where}: audio file ${item.audio} does not exist yet (paths are relative to ${relative(root, ld.dir) || ld.dir}/)`);
      }
    }
    audio = { recorded: audio.recorded + drillCoverage(ld).recorded, total: audio.total + items.length };
  }
  return { issues, audio };
}

/** Recorded = the audio field is set and the file exists (or is a remote URL). */
export function drillCoverage(ld: LoadedDrill): Coverage {
  const items = drillItems(ld.drill);
  const recorded = items.filter(({ item }) => item.audio && (isRemote(item.audio) || existsSync(join(ld.dir, item.audio)))).length;
  return { recorded, total: items.length };
}

// ---------------------------------------------------------------------------------------------
// Audio manifest

export type DrillAudioEntry = Omit<AudioEntry, 'kind' | 'source'> & {
  kind: 'pron-pair' | 'pron-word' | 'pron-sentence';
  drill: string;
  /** YAML file relative to content/pronunciation and the pointer to the audio field. */
  source: { file: string; id: string; pointer: Array<string | number> };
};

export type PronunciationManifest = {
  folder: typeof PRONUNCIATION_DIR;
  delivery: typeof DELIVERY;
  drills: Array<{ id: string; title: string; variety: Variety; level: string }>;
  entries: DrillAudioEntry[];
};

/**
 * Recordings for all drills, in drill-id order. File names: pron-<id>-pair-NN-a.mp3 / -b.mp3,
 * pron-<id>-word-NN.mp3, pron-<id>-sentence-NN.mp3; the YAML path is audio/<file> (relative to
 * content/pronunciation/<id>/). Both words of a pair use the same voice so only the sound changes;
 * words and sentences alternate voices.
 */
export function buildPronunciationManifest(drills: LoadedDrill[]): PronunciationManifest {
  const sorted = [...drills].sort((a, b) => a.drill.id.localeCompare(b.drill.id));
  const entries: DrillAudioEntry[] = [];
  for (const { drill: d } of sorted) {
    let alt = 0;
    for (const it of drillItems(d)) {
      const g: Gender = it.kind === 'pron-pair' ? (Number(it.pointer[1]) % 2 === 0 ? 'f' : 'm') : alt++ % 2 === 0 ? 'f' : 'm';
      const file = `${PRON_PREFIX}${d.id}-${it.part}.mp3`;
      const path = `audio/${file}`;
      const entry: DrillAudioEntry = {
        file, path, kind: it.kind, drill: d.id, text: it.item.text, en: it.item.en, variety: d.variety,
        voice: voiceFor(d.variety, g) as Voice,
        source: { file: `${d.id}.yaml`, id: d.id, pointer: it.pointer },
        referenced: it.item.audio === path,
      };
      if (it.item.audio && it.item.audio !== path) entry.current = it.item.audio;
      entries.push(entry);
    }
  }
  return {
    folder: PRONUNCIATION_DIR,
    delivery: DELIVERY,
    drills: sorted.map(({ drill: d }) => ({ id: d.id, title: d.title, variety: d.variety, level: d.level })),
    entries,
  };
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Recording script for the pronunciation drills (content/pronunciation/audio-script.md). */
export function renderPronunciationScript(m: PronunciationManifest): string {
  const out: string[] = [];
  out.push('# Audio script: pronunciation drills', '');
  out.push('Generated by `npm run audio:scripts` from content/pronunciation/*.yaml. Do not edit by hand; see docs/AUDIO.md.', '');
  out.push(`- Deliver: ${m.delivery.raw}.`);
  out.push(`- Name each raw file after the File column with the extension changed, e.g. \`${(m.entries[0]?.file ?? 'pron-ue-u-i-pair-01-a.mp3').replace(/\.mp3$/, '.wav')}\`.`);
  out.push('- Minimal pairs: read both words of a pair in the same voice, with the same intonation, so that only the sound differs. Do not exaggerate the contrast.');
  out.push('- Words: citation form, natural stress. Sentences: natural pace, slightly slower than conversation.');
  out.push('- Done = the YAML already references the processed file.', '');
  const voices = new Map<string, number>();
  for (const e of m.entries) voices.set(e.voice, (voices.get(e.voice) ?? 0) + 1);
  out.push('## Voices', '', '| Voice | Files |', '| --- | --- |');
  for (const [v, n] of [...voices].sort(([a], [b]) => a.localeCompare(b))) out.push(`| ${v} | ${n} |`);
  out.push('', `Total: ${m.entries.length} file(s) in ${m.drills.length} drill(s), ${m.entries.filter((e) => e.referenced).length} done.`, '');
  for (const d of m.drills) {
    const list = m.entries.filter((e) => e.drill === d.id);
    out.push(`## ${cell(d.title)} (${d.id}, ${d.variety})`, '');
    if (!list.length) {
      out.push('No recordings.', '');
      continue;
    }
    out.push('| File | Voice | Text | English | Done |', '| --- | --- | --- | --- | --- |');
    for (const e of list) out.push(`| \`${e.file}\` | ${e.voice} | ${cell(e.text)} | ${cell(e.en)} | ${e.referenced ? 'yes' : ''} |`);
    out.push('');
  }
  return out.join('\n');
}
