// Audio manifest: the list of every recording a unit needs, with a stable file name, the text,
// the variety and a suggested voice. `npm run audio:scripts` writes it next to the unit as
// audio-manifest.json (machine-readable) and audio-script.md (for voice actors). The same
// manifest drives `audio:process` (which raw files are expected), `audio:link` (which YAML field
// each file belongs to) and the audio coverage numbers in lint, report and build.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CompiledUnit, Exercise, Level, Variety } from '@doppelpunkt/content-schema';
import { UNIT_FILES } from './load';

export type Gender = 'f' | 'm';
/** de = German voice, zh = Zurich voice, be = Bernese voice. */
export type Voice = `${'de' | 'zh' | 'be'}-${Gender}`;
export type AudioKind =
  | 'dialogue-intro'
  | 'dialogue-swiss'
  | 'vocab'
  | 'vocab-example'
  | 'vocab-gsw-zh'
  | 'vocab-gsw-be'
  | 'dictation'
  | 'speak'
  | 'listening';

/** Pointer into a unit YAML file to the audio field this recording fills (`audio`, `example.audio`, `gswZhAudio`, `gswBeAudio`); null when the schema has no field for it. */
export type AudioSource = { file: (typeof UNIT_FILES)[keyof typeof UNIT_FILES]; id?: string; pointer: Array<string | number> | null };

export type AudioEntry = {
  /** Delivered file name (processed). Raw recordings use the same base name with any audio extension. */
  file: string;
  /** Value for the YAML `audio` field, relative to the unit folder. */
  path: string;
  kind: AudioKind;
  text: string;
  /** Reading note for the speaker, e.g. "(to a group)" stripped from the text. */
  note?: string;
  en?: string;
  variety: Variety;
  voice: Voice;
  speaker?: string;
  /** True when the voice gender was not known from the cast list. */
  voiceGuessed?: true;
  source: AudioSource;
  /** The YAML `audio` field already points at `path`. */
  referenced: boolean;
  /** The YAML `audio` field points somewhere else (set by hand). */
  current?: string;
};

export type AudioManifest = {
  unitId: string;
  level: Level;
  /** Folder relative to content/, e.g. "a1/unit-01". */
  folder: string;
  title: string;
  delivery: { raw: string; processed: string[] };
  entries: AudioEntry[];
};

export const AUDIO_DIR = 'audio';
export const DELIVERY = {
  raw: 'WAV or FLAC, 48 kHz, 24-bit, mono, one file per entry, named <file base>.wav',
  processed: ['mp3 64 kbps mono 44.1 kHz', 'opus 32 kbps mono 48 kHz', 'EBU R128 -16 LUFS, true peak -1.5 dBTP'],
};

/** Known cast. Extend when a unit introduces a new speaking character. */
export const CAST: Record<string, Gender> = {
  Anna: 'f', Tom: 'm', Reto: 'm', Sandra: 'f', Lena: 'f', Noah: 'm', Martin: 'm',
  'Frau Keller': 'f', Kellnerin: 'f', Kellner: 'm', Verkäuferin: 'f', Verkäufer: 'm',
  waitress: 'f', waiter: 'm', teacher: 'f',
  // Units 7–12 and the mock exams: transcript speaker labels.
  Mami: 'f', Nadine: 'f', Mia: 'f', Marco: 'm', Kassierer: 'm', Passantin: 'f',
  Frau: 'f', Mann: 'm', Sprecher: 'm', Sprecherin: 'f', Praxis: 'f',
};

/** Gender of a named speaker, from the cast list or the title (Frau/Herr) or a feminine -in noun. */
export function speakerGender(speaker: string): Gender | undefined {
  const s = speaker.trim();
  if (CAST[s]) return CAST[s];
  if (/^(Frau|Ms|Mrs)\b/.test(s)) return 'f';
  if (/^(Herr|Mr)\b/.test(s)) return 'm';
  // Feminine role nouns: Kellnerin, Verkäuferin, Ärztin.
  if (/^[A-ZÄÖÜ][a-zäöüß]+(erin|ärin|ztin)$/.test(s)) return 'f';
  return undefined;
}

export function voiceFor(variety: Variety, gender: Gender): Voice {
  // Swiss Standard German is read by Swiss (Zurich) speakers: the accent is part of the variety.
  const prefix = variety === 'de' ? 'de' : variety === 'gsw-be' ? 'be' : 'zh';
  return `${prefix}-${gender}`;
}

type DialogueLine = CompiledUnit['intro']['dialogue'][number];

const pad = (n: number) => String(n).padStart(2, '0');

/** Split "Grüezi! / Grüezi mitenand! (to a group)" into reading text and note. */
export function readingText(s: string): { text: string; note?: string } {
  const notes: string[] = [];
  const text = s
    .replace(/\s*\(([^)]*)\)/g, (_, n: string) => {
      notes.push(n.trim());
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return notes.length ? { text, note: notes.join('; ') } : { text };
}

/** Text quoted in a prompt ("…", „…“, “…”), joined; used as the listening stimulus. */
export function quoted(prompt: string): string | undefined {
  const parts = [...prompt.matchAll(/"([^"]+)"|„([^“”]+)[“”]|“([^”]+)”/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim());
  const out = parts.filter(Boolean).join(' ');
  return out || undefined;
}

export function promptSpeaker(prompt: string): string | undefined {
  const head = prompt.split(/["„“]/)[0] ?? prompt;
  let best: { name: string; at: number } | undefined;
  for (const name of Object.keys(CAST)) {
    const at = head.search(new RegExp(`\\b${name}\\b`));
    if (at >= 0 && (!best || at < best.at)) best = { name, at };
  }
  return best?.name;
}

/** First speaker label of a transcript ("Frau: ..." → "Frau"), if any. */
export function transcriptSpeaker(transcript: string): string | undefined {
  return /^\s*([A-ZÄÖÜ][\p{L}. ]{0,24}):/mu.exec(transcript)?.[1]?.trim();
}

/**
 * What an exercise needs recorded as `ex-<id>`: the dictation text, the speaking model, or what a
 * listening item plays (its `transcript`; older items without one: the text quoted in the prompt).
 */
export function exerciseText(ex: Exercise): { kind: AudioKind; text: string; speaker?: string } | undefined {
  if (ex.type === 'dictation') return { kind: 'dictation', text: ex.transcript };
  if (ex.type === 'speak') return { kind: 'speak', text: ex.target };
  if (ex.type === 'roleplay') return undefined;
  if (ex.transcript?.trim()) {
    const text = ex.transcript.trim();
    const speaker = transcriptSpeaker(text) ?? promptSpeaker(ex.prompt);
    return { kind: 'listening', text, ...(speaker ? { speaker } : {}) };
  }
  if (ex.skill === 'listening') {
    // Listening items that say "Listen to the dialogue" reuse the dialogue recordings.
    const q = quoted(ex.prompt);
    if (q) {
      const speaker = promptSpeaker(ex.prompt);
      return { kind: 'listening', text: q, ...(speaker ? { speaker } : {}) };
    }
  }
  return undefined;
}

/** Build the manifest for one compiled unit. Pure and deterministic (content order). */
export function buildManifest(unit: CompiledUnit, folder: string): AudioManifest {
  const entries: AudioEntry[] = [];
  const guessed = new Map<string, Gender>();
  let alt = 0;
  const gender = (speaker: string | undefined, fallback: Gender): { g: Gender; guessed?: true } => {
    if (!speaker) return { g: fallback };
    const known = speakerGender(speaker);
    if (known) return { g: known };
    if (!guessed.has(speaker)) guessed.set(speaker, guessed.size % 2 === 0 ? 'f' : 'm');
    return { g: guessed.get(speaker)!, guessed: true };
  };
  const add = (e: Omit<AudioEntry, 'path' | 'referenced' | 'current'>, yamlAudio: string | undefined) => {
    const path = `${AUDIO_DIR}/${e.file}`;
    const entry: AudioEntry = { ...e, path, referenced: yamlAudio === path };
    if (yamlAudio && yamlAudio !== path) entry.current = yamlAudio;
    entries.push(entry);
  };

  const dialogue = (lines: DialogueLine[], lane: 'intro' | 'swiss') =>
    lines.forEach((l, i) => {
      const { g, guessed: gu } = gender(l.speaker, 'f');
      add(
        {
          file: `dialog-${lane}-${pad(i + 1)}.mp3`,
          kind: lane === 'intro' ? 'dialogue-intro' : 'dialogue-swiss',
          text: l.text,
          en: l.en,
          variety: l.variety,
          voice: voiceFor(l.variety, g),
          speaker: l.speaker,
          ...(gu ? { voiceGuessed: true as const } : {}),
          source: { file: UNIT_FILES.unit, pointer: [lane, 'dialogue', i, 'audio'] },
        },
        l.audio,
      );
    });
  dialogue(unit.intro.dialogue, 'intro');
  dialogue(unit.swiss.dialogue, 'swiss');

  unit.vocab.forEach((v, i) => {
    const g: Gender = i % 2 === 0 ? 'f' : 'm';
    const other: Gender = g === 'f' ? 'm' : 'f';
    const word = readingText(v.de);
    add(
      { file: `vocab-${v.id}.mp3`, kind: 'vocab', ...word, en: v.en, variety: 'de', voice: voiceFor('de', g), source: { file: UNIT_FILES.vocab, id: v.id, pointer: [i, 'audio'] } },
      v.audio,
    );
    if (v.example) {
      add(
        { file: `vocab-${v.id}-ex.mp3`, kind: 'vocab-example', text: v.example.de, en: v.example.en, variety: 'de', voice: voiceFor('de', other), source: { file: UNIT_FILES.vocab, id: v.id, pointer: [i, 'example', 'audio'] } },
        v.example.audio,
      );
    }
    if (v.gswZh) {
      add(
        { file: `vocab-${v.id}-zh.mp3`, kind: 'vocab-gsw-zh', ...readingText(v.gswZh), en: v.en, variety: 'gsw-zh', voice: voiceFor('gsw-zh', g), source: { file: UNIT_FILES.vocab, id: v.id, pointer: [i, 'gswZhAudio'] } },
        v.gswZhAudio,
      );
    }
    if (v.gswBe) {
      add(
        { file: `vocab-${v.id}-be.mp3`, kind: 'vocab-gsw-be', ...readingText(v.gswBe), en: v.en, variety: 'gsw-be', voice: voiceFor('gsw-be', g), source: { file: UNIT_FILES.vocab, id: v.id, pointer: [i, 'gswBeAudio'] } },
        v.gswBeAudio,
      );
    }
  });

  unit.exercises.forEach((ex, i) => {
    const t = exerciseText(ex);
    if (!t) return;
    const speaker = t.speaker;
    const { g, guessed: gu } = gender(speaker, alt++ % 2 === 0 ? 'f' : 'm');
    add(
      {
        file: `ex-${ex.id}.mp3`,
        kind: t.kind,
        text: t.text,
        variety: ex.variety,
        voice: voiceFor(ex.variety, g),
        ...(speaker ? { speaker } : {}),
        ...(gu ? { voiceGuessed: true as const } : {}),
        source: { file: UNIT_FILES.exercises, id: ex.id, pointer: [i, 'audio'] },
      },
      ex.audio,
    );
  });

  return { unitId: unit.id, level: unit.level, folder, title: unit.title, delivery: DELIVERY, entries };
}

export const isRemote = (p: string) => /^(https?:|data:|blob:|\/)/.test(p);

/** Audio fields that are set anywhere in the unit (including ones outside the manifest). */
export function audioRefs(u: CompiledUnit): Array<{ file: string; path: string; where: string }> {
  const out: Array<{ file: string; path: string; where: string }> = [];
  u.intro.dialogue.forEach((l, i) => l.audio && out.push({ file: UNIT_FILES.unit, path: l.audio, where: `intro.dialogue[${i}]` }));
  u.swiss.dialogue.forEach((l, i) => l.audio && out.push({ file: UNIT_FILES.unit, path: l.audio, where: `swiss.dialogue[${i}]` }));
  u.vocab.forEach((v, i) => {
    const at = `[${i}] (id: ${v.id})`;
    if (v.audio) out.push({ file: UNIT_FILES.vocab, path: v.audio, where: at });
    if (v.example?.audio) out.push({ file: UNIT_FILES.vocab, path: v.example.audio, where: `${at} example` });
    if (v.gswZhAudio) out.push({ file: UNIT_FILES.vocab, path: v.gswZhAudio, where: `${at} gswZhAudio` });
    if (v.gswBeAudio) out.push({ file: UNIT_FILES.vocab, path: v.gswBeAudio, where: `${at} gswBeAudio` });
  });
  u.exercises.forEach((e, i) => e.audio && out.push({ file: UNIT_FILES.exercises, path: e.audio, where: `[${i}] (id: ${e.id})` }));
  return out;
}

export type Coverage = { recorded: number; total: number };

/**
 * Coverage over the recording slots that have a YAML field: a slot counts as recorded when its
 * `audio` field is set and the file exists (or is a remote URL).
 */
export function coverage(m: AudioManifest, unitDir: string): Coverage {
  const slots = m.entries.filter((e) => e.source.pointer);
  const recorded = slots.filter((e) => {
    const p = e.referenced ? e.path : e.current;
    return p !== undefined && (isRemote(p) || existsSync(join(unitDir, p)));
  }).length;
  return { recorded, total: slots.length };
}

export const addCoverage = (a: Coverage, b: Coverage): Coverage => ({ recorded: a.recorded + b.recorded, total: a.total + b.total });
export const formatCoverage = (c: Coverage) => `${c.recorded}/${c.total}${c.total ? ` (${Math.round((100 * c.recorded) / c.total)}%)` : ''}`;

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Recording script for voice actors and the producer. */
export function renderScript(m: AudioManifest): string {
  const out: string[] = [];
  out.push(`# Audio script: ${m.level} unit ${Number(m.folder.split('-').pop())} "${m.title}" (${m.unitId})`, '');
  out.push('Generated by `npm run audio:scripts` from the unit YAML. Do not edit by hand; see docs/AUDIO.md.', '');
  out.push(`- Deliver: ${m.delivery.raw}.`);
  out.push(`- Name each raw file after the File column with the extension changed, e.g. \`${(m.entries[0]?.file ?? 'dialog-intro-01.mp3').replace(/\.mp3$/, '.wav')}\`.`);
  out.push('- Read alternatives separated by " / " one after the other with a one-second pause.');
  out.push('- Done = the YAML already references the processed file.', '');

  const voices = new Map<Voice, { n: number; speakers: Set<string> }>();
  for (const e of m.entries) {
    const v = voices.get(e.voice) ?? { n: 0, speakers: new Set<string>() };
    v.n++;
    if (e.speaker) v.speakers.add(e.speaker);
    voices.set(e.voice, v);
  }
  out.push('## Voices', '', '| Voice | Files | Characters |', '| --- | --- | --- |');
  for (const [voice, v] of [...voices].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`| ${voice} | ${v.n} | ${cell([...v.speakers].sort().join(', '))} |`);
  }
  out.push('', `Total: ${m.entries.length} file(s), ${m.entries.filter((e) => e.referenced).length} done.`, '');

  const sections: Array<{ title: string; kinds: AudioKind[] }> = [
    { title: 'Intro dialogue', kinds: ['dialogue-intro'] },
    { title: 'Swiss lane dialogue', kinds: ['dialogue-swiss'] },
    { title: 'Vocabulary', kinds: ['vocab', 'vocab-example', 'vocab-gsw-zh', 'vocab-gsw-be'] },
    { title: 'Exercises (dictation, speaking, listening)', kinds: ['dictation', 'speak', 'listening'] },
  ];
  for (const s of sections) {
    const list = m.entries.filter((e) => s.kinds.includes(e.kind));
    if (!list.length) continue;
    out.push(`## ${s.title}`, '', '| File | Voice | Variety | Speaker | Text | English / note | Done |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const e of list) {
      const en = [e.en, e.note ? `note: ${e.note}` : undefined].filter(Boolean).join(' · ');
      out.push(`| \`${e.file}\` | ${e.voice}${e.voiceGuessed ? ' (?)' : ''} | ${e.variety} | ${cell(e.speaker)} | ${cell(e.text)} | ${cell(en)} | ${e.referenced ? 'yes' : ''} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
