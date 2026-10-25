// Mock exams: content/<level>/exam/<id>.yaml, one MockExam per file (file name = id).
// Audio paths in an exam are relative to the exam's folder content/<level>/exam/<id>/
// (e.g. `audio: audio/stimulus-hoeren-1.mp3`), and the build copies them to
// apps/web/public/packs/audio/<level>/<exam id>/<path>, the same layout as unit audio (the exam id
// takes the place of the unit id, so exam ids must not clash with unit ids).
// This module loads and lints exams, builds the per-level exam audio manifest
// (content/<level>/exam/audio-manifest.json + audio-script.md) and computes audio coverage.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { MockExam, type Exercise, type Level, type Variety } from '@doppelpunkt/content-schema';
import { examMaxPoints, sectionPoints } from '@doppelpunkt/engine';
import { DELIVERY, exerciseText, isRemote, promptSpeaker, speakerGender, voiceFor, type AudioEntry, type AudioKind, type Coverage, type Gender } from './audio';
import { levelDirs, readYaml, zodIssues, type Issue, type LoadedUnit } from './load';
import { exerciseRules, listeningRules } from './rules';

export const EXAM_DIR = 'exam';

export type LoadedExam = {
  level: Level;
  /** YAML file, absolute. */
  file: string;
  /** Folder that audio paths are relative to: content/<level>/exam/<id>/. */
  dir: string;
  exam: MockExam;
};

const EXAM_FILE = /^([^.]+)\.ya?ml$/;
const KNOWN_KEYS = new Set(Object.keys(MockExam.shape));

/** Folder of a level's exams relative to content/, e.g. "a1/exam". */
export const examFolder = (level: Level) => `${level.toLowerCase()}/${EXAM_DIR}`;
/** Folder of one exam relative to content/, e.g. "a1/exam/a1-modelltest-1" (audio:process --unit). */
export const examAudioFolder = (le: Pick<LoadedExam, 'level' | 'exam'>) => `${examFolder(le.level)}/${le.exam.id}`;

/** Exam files of one level folder (sorted by name). The audio manifest and script are not exams. */
export function examFiles(levelDir: string): string[] {
  const dir = join(levelDir, EXAM_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => EXAM_FILE.test(n) && statSync(join(dir, n)).isFile())
    .sort()
    .map((n) => join(dir, n));
}

/** Load and schema-validate every exam of every level. File name must equal the id; level must match the folder. */
export function loadExams(contentDir: string, root = process.cwd()): { exams: LoadedExam[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const exams: LoadedExam[] = [];
  for (const { level, dir } of levelDirs(contentDir)) {
    for (const file of examFiles(dir)) {
      const rel = relative(root, file) || file;
      const y = readYaml(file, issues, root);
      if (!y.ok) continue;
      if (y.data && typeof y.data === 'object' && !Array.isArray(y.data)) {
        const unknown = Object.keys(y.data).filter((k) => !KNOWN_KEYS.has(k));
        if (unknown.length) issues.push({ severity: 'warning', file: rel, message: `unknown field(s) ignored: ${unknown.join(', ')} (known: ${[...KNOWN_KEYS].join(', ')})` });
      }
      const parsed = MockExam.safeParse(y.data);
      if (!parsed.success) {
        issues.push(...zodIssues(rel, parsed.error, y.data));
        continue;
      }
      const stem = EXAM_FILE.exec(basename(file))![1]!;
      if (parsed.data.id !== stem) {
        issues.push({ severity: 'error', file: rel, message: `id is "${parsed.data.id}" but the file is named ${basename(file)}; name the file ${parsed.data.id}.yaml` });
        continue;
      }
      if (parsed.data.level !== level) {
        issues.push({ severity: 'error', file: rel, message: `level is ${parsed.data.level} but the folder is ${level.toLowerCase()}/` });
        continue;
      }
      exams.push({ level, file, dir: join(dir, EXAM_DIR, parsed.data.id), exam: parsed.data });
    }
  }
  return { exams, issues };
}

/**
 * Expected time per level, in minutes: written papers (Hören + Lesen + Schreiben) and the
 * speaking test, after the Goethe / telc / ÖSD formats. Outside the range is a warning.
 */
export const EXAM_MINUTES: Record<Level, { written: [number, number]; speaking: [number, number] }> = {
  A1: { written: [60, 90], speaking: [10, 20] },
  A2: { written: [80, 120], speaking: [10, 20] },
  B1: { written: [140, 190], speaking: [12, 25] },
  B2: { written: [160, 210], speaking: [12, 25] },
  C1: { written: [170, 220], speaking: [15, 25] },
  C2: { written: [170, 240], speaking: [15, 30] },
};

/** Minutes of the written papers and of the speaking test. */
export function examMinutes(exam: MockExam): { written: number; speaking: number } {
  let written = 0;
  let speaking = 0;
  for (const s of exam.sections) {
    if (s.skill === 'speaking') speaking += s.minutes;
    else written += s.minutes;
  }
  return { written, speaking };
}

type Slot = { path: string; where: string };

/** Audio fields that are set anywhere in the exam (stimulus and exercises), with a readable location. */
export function examAudioRefs(exam: MockExam): Slot[] {
  const out: Slot[] = [];
  exam.sections.forEach((s, si) => {
    if (s.stimulus?.audio) out.push({ path: s.stimulus.audio, where: `sections[${si}] (id: ${s.id}) stimulus` });
    s.exercises.forEach((e, ei) => e.audio && out.push({ path: e.audio, where: `sections[${si}].exercises[${ei}] (id: ${e.id})` }));
  });
  return out;
}

export type ExamLint = { issues: Issue[]; audio: Coverage };

/**
 * Editorial rules for exams. `units` are the loaded units (exercise ids must be unique across the
 * units and exams of a level); `knownGrammar` are the grammar ids defined in any unit.
 */
export function lintExams(exams: LoadedExam[], units: LoadedUnit[], knownGrammar: Set<string>, root = process.cwd()): ExamLint {
  const issues: Issue[] = [];
  let audio: Coverage = { recorded: 0, total: 0 };
  const byLevel = new Map<Level, LoadedExam[]>();
  for (const le of exams) byLevel.set(le.level, [...(byLevel.get(le.level) ?? []), le]);

  for (const [level, list] of byLevel) {
    // Exercise and unit ids already used by the level's units.
    const exerciseOwner = new Map<string, string>();
    const unitIds = new Map<string, string>();
    for (const lu of units.filter((u) => u.level === level)) {
      const where = relative(root, lu.dir) || lu.dir;
      unitIds.set(lu.unit.id, where);
      for (const e of lu.unit.exercises) if (!exerciseOwner.has(e.id)) exerciseOwner.set(e.id, `${where}/exercises.yaml`);
    }
    const examIds = new Map<string, string>();

    for (const le of list) {
      const x = le.exam;
      const file = relative(root, le.file) || le.file;
      const push = (severity: Issue['severity'], f: string, message: string) => issues.push({ severity, file: f, message });
      const warn = (m: string) => push('warning', file, m);
      const err = (m: string) => push('error', file, m);

      if (examIds.has(x.id)) err(`duplicate exam id "${x.id}" (also in ${examIds.get(x.id)})`);
      else examIds.set(x.id, file);
      if (unitIds.has(x.id)) err(`exam id "${x.id}" is also a unit id (${unitIds.get(x.id)})`);
      if (!x.title.trim()) err('title is empty');

      const sectionIds = new Map<string, number>();
      x.sections.forEach((s, si) => {
        const at = `sections[${si}] (id: ${s.id})`;
        if (sectionIds.has(s.id)) err(`${at}: duplicate section id (also sections[${sectionIds.get(s.id)}])`);
        else sectionIds.set(s.id, si);
        if (!s.exercises.length) err(`${at}: a section needs at least one item`);
        if (!s.instructions.trim()) err(`${at}: instructions are empty`);
        if (s.points && s.points.length !== s.exercises.length) {
          err(`${at}: points has ${s.points.length} entr${s.points.length === 1 ? 'y' : 'ies'} but the section has ${s.exercises.length} exercise(s)`);
        }
        if (s.points?.some((p) => p === 0)) warn(`${at}: an item is worth 0 points`);
        s.exercises.forEach((ex, ei) => {
          const where = `${at}.exercises[${ei}]`;
          const prev = exerciseOwner.get(ex.id);
          if (prev) err(`${where} (id: ${ex.id}): duplicate exercise id "${ex.id}" (also in ${prev})`);
          else exerciseOwner.set(ex.id, `${file} ${at}`);
          exerciseRules(ex, where, file, push);
          listeningRules(s.skill === 'listening' && ex.skill !== 'listening' ? { ...ex, skill: 'listening' } : ex, !!s.stimulus?.text.trim(), where, file, push);
          for (const g of ex.grammar) {
            if (!knownGrammar.has(g)) warn(`${where} (id: ${ex.id}): grammar "${g}" is not defined in any unit`);
          }
          if (s.skill !== 'speaking' && (ex.type === 'speak' || ex.type === 'roleplay')) warn(`${where} (id: ${ex.id}): ${ex.type} item in a ${s.skill} section`);
          if (s.skill === 'speaking' && ex.type !== 'speak' && ex.type !== 'roleplay') warn(`${where} (id: ${ex.id}): ${ex.type} item in the speaking section (expected speak or roleplay)`);
        });
        const mcqs = s.exercises.filter((e): e is Extract<Exercise, { type: 'mcq' }> => e.type === 'mcq');
        if (mcqs.length >= 3 && new Set(mcqs.map((e) => e.answer)).size === 1) {
          warn(`${at}: all ${mcqs.length} mcq items have answer: ${mcqs[0]!.answer}; vary the position of the correct option`);
        }
      });

      // Papers that follow an exam family must be complete; a generic practice test (e.g. a Swiss
      // German listening check) may be shorter, but not longer than the real exam.
      const full = x.format !== 'generic';
      if (full) {
        for (const skill of ['listening', 'reading', 'writing', 'speaking'] as const) {
          if (!x.sections.some((s) => s.skill === skill)) warn(`no ${skill} section (real ${x.level} papers have Hören, Lesen, Schreiben and Sprechen)`);
        }
      }
      const min = examMinutes(x);
      const range = EXAM_MINUTES[x.level];
      if ((full && min.written < range.written[0]) || min.written > range.written[1]) {
        warn(`written papers (listening + reading + writing) take ${min.written} min; ${x.level} exams usually take ${range.written[0]}–${range.written[1]} min`);
      }
      if (x.sections.some((s) => s.skill === 'speaking') && ((full && min.speaking < range.speaking[0]) || min.speaking > range.speaking[1])) {
        warn(`speaking takes ${min.speaking} min; ${x.level} speaking tests usually take ${range.speaking[0]}–${range.speaking[1]} min`);
      }
      if (examMaxPoints(x) <= 0) err('the exam has no points');

      for (const ref of examAudioRefs(x)) {
        if (!isRemote(ref.path) && !existsSync(join(le.dir, ref.path))) {
          warn(`${ref.where}: audio file ${ref.path} does not exist yet (paths are relative to ${relative(root, le.dir) || le.dir}/)`);
        }
      }
      audio = { recorded: audio.recorded + examCoverage(le).recorded, total: audio.total + examCoverage(le).total };
    }
  }
  return { issues, audio };
}

// ---------------------------------------------------------------------------------------------
// Audio manifest

export type ExamAudioEntry = Omit<AudioEntry, 'kind' | 'source'> & {
  kind: Extract<AudioKind, 'dictation' | 'speak' | 'listening'> | 'exam-stimulus';
  exam: string;
  /** YAML file relative to content/<level>/exam and the pointer to the audio field. */
  source: { file: string; id: string; pointer: Array<string | number> };
};

export type ExamAudioManifest = {
  /** e.g. "a1/exam". */
  folder: string;
  level: Level;
  delivery: typeof DELIVERY;
  exams: Array<{ id: string; title: string }>;
  entries: ExamAudioEntry[];
};

/**
 * Recordings for the exams of one level, in exam-id order: the stimulus of each listening section
 * (`stimulus-<section id>.mp3`, text = stimulus.text) and the exercises that units would record
 * too (dictation, speaking model, listening item `transcript`: `ex-<exercise id>.mp3`).
 * The YAML path is audio/<file>, relative to content/<level>/exam/<id>/.
 */
export function buildExamManifest(level: Level, exams: LoadedExam[]): ExamAudioManifest {
  const sorted = exams.filter((e) => e.level === level).sort((a, b) => a.exam.id.localeCompare(b.exam.id));
  const entries: ExamAudioEntry[] = [];
  for (const { exam: x } of sorted) {
    let alt = 0;
    const add = (e: Omit<ExamAudioEntry, 'path' | 'referenced' | 'current' | 'exam' | 'voice'> & { gender: Gender }, current: string | undefined) => {
      const { gender, ...rest } = e;
      const path = `audio/${e.file}`;
      const entry: ExamAudioEntry = { ...rest, exam: x.id, path, voice: voiceFor(e.variety, gender), referenced: current === path };
      if (current && current !== path) entry.current = current;
      entries.push(entry);
    };
    const pick = (speaker: string | undefined): Gender => (speaker && speakerGender(speaker)) || (alt++ % 2 === 0 ? 'f' : 'm');
    x.sections.forEach((s, si) => {
      if (s.skill === 'listening' && s.stimulus?.text.trim()) {
        // A speaker label ("Frau: ...") names the first voice; a name in running text is only a guess.
        const label = /^\s*([A-ZÄÖÜ][\p{L} ]{1,24}):/mu.exec(s.stimulus.text)?.[1]?.trim();
        const speaker = label ?? promptSpeaker(s.stimulus.text);
        add({
          ...(!label ? { voiceGuessed: true as const } : {}),
          file: `stimulus-${s.id}.mp3`, kind: 'exam-stimulus', text: s.stimulus.text.trim(),
          ...(s.stimulus.title ? { en: s.stimulus.title } : {}),
          variety: s.stimulus.variety, gender: pick(speaker), ...(speaker ? { speaker } : {}),
          source: { file: `${x.id}.yaml`, id: s.id, pointer: ['sections', si, 'stimulus', 'audio'] },
        }, s.stimulus.audio);
      }
      s.exercises.forEach((ex, ei) => {
        const t = exerciseText(ex);
        if (!t) return;
        const speaker = t.speaker;
        add({
          file: `ex-${ex.id}.mp3`, kind: t.kind as ExamAudioEntry['kind'], text: t.text, variety: ex.variety as Variety,
          gender: pick(speaker), ...(speaker ? { speaker } : {}),
          source: { file: `${x.id}.yaml`, id: ex.id, pointer: ['sections', si, 'exercises', ei, 'audio'] },
        }, ex.audio);
      });
    });
  }
  return { folder: examFolder(level), level, delivery: DELIVERY, exams: sorted.map((e) => ({ id: e.exam.id, title: e.exam.title })), entries };
}

/** Coverage over the exam's recording slots (manifest entries): recorded = field set and file exists. */
export function examCoverage(le: LoadedExam): Coverage {
  const entries = buildExamManifest(le.level, [le]).entries;
  const recorded = entries.filter((e) => {
    const p = e.referenced ? e.path : e.current;
    return p !== undefined && (isRemote(p) || existsSync(join(le.dir, p)));
  }).length;
  return { recorded, total: entries.length };
}

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Recording script for the exams of one level (content/<level>/exam/audio-script.md). */
export function renderExamScript(m: ExamAudioManifest): string {
  const out: string[] = [];
  out.push(`# Audio script: ${m.level} mock exams`, '');
  out.push(`Generated by \`npm run audio:scripts\` from content/${m.folder}/*.yaml. Do not edit by hand; see docs/AUDIO.md.`, '');
  out.push(`- Deliver: ${m.delivery.raw}.`);
  out.push(`- Put the files of each exam in its own folder (raw/${m.folder}/<exam id>/), named after the File column with the extension changed.`);
  out.push('- Stimuli are read like the real exam recordings: natural pace for the level, clear, with a short pause between speakers. Read speaker labels ("Anna:") only as a change of voice, not aloud.');
  out.push('- Done = the YAML already references the processed file.', '');
  const voices = new Map<string, number>();
  for (const e of m.entries) voices.set(e.voice, (voices.get(e.voice) ?? 0) + 1);
  out.push('## Voices', '', '| Voice | Files |', '| --- | --- |');
  for (const [v, n] of [...voices].sort(([a], [b]) => a.localeCompare(b))) out.push(`| ${v} | ${n} |`);
  out.push('', `Total: ${m.entries.length} file(s) in ${m.exams.length} exam(s), ${m.entries.filter((e) => e.referenced).length} done.`, '');
  for (const x of m.exams) {
    const list = m.entries.filter((e) => e.exam === x.id);
    out.push(`## ${cell(x.title)} (${x.id})`, '');
    if (!list.length) {
      out.push('No recordings.', '');
      continue;
    }
    out.push('| File | Voice | Variety | Speaker | Text | Done |', '| --- | --- | --- | --- | --- | --- |');
    for (const e of list) out.push(`| \`${e.file}\` | ${e.voice} | ${e.variety} | ${cell(e.speaker)} | ${cell(e.text)} | ${e.referenced ? 'yes' : ''} |`);
    out.push('');
  }
  return out.join('\n');
}

/** Summary numbers for content:report. */
export function examSummary(le: LoadedExam) {
  const x = le.exam;
  const min = examMinutes(x);
  return {
    id: x.id,
    level: x.level,
    title: x.title,
    format: x.format,
    sections: x.sections.length,
    items: x.sections.reduce((n, s) => n + s.exercises.length, 0),
    points: examMaxPoints(x),
    passMark: x.passMark,
    written: min.written,
    speaking: min.speaking,
    skills: x.sections.map((s) => ({ id: s.id, skill: s.skill, items: s.exercises.length, points: sectionPoints(s).reduce((a, b) => a + b, 0), minutes: s.minutes })),
    audio: examCoverage(le),
  };
}
export type ExamSummary = ReturnType<typeof examSummary>;
