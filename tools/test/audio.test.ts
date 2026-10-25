import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest, quoted, readingText, renderScript, speakerGender, voiceFor } from '../src/audio';
import { linkAudio } from '../src/audio-link';
import { findFfmpeg, processAudio } from '../src/audio-process';
import { exportScripts } from '../src/audio-scripts';
import { buildPacks } from '../src/build-packs';
import { lintContent } from '../src/lint';
import { loadContent } from '../src/load';
import { exercises, makeFixture, unitYaml, vocab, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const unitDir = (n = 1) => join(f.content, 'a1', `unit-${String(n).padStart(2, '0')}`);
const base = { prompt: 'Do it.', explanation: 'Because.' };

function richUnit() {
  writeUnit(f, 'A1', 1, {
    unit: {
      intro: {
        scene: 'Class.',
        dialogue: [
          { speaker: 'Frau Keller', text: 'Guten Morgen!', en: 'Good morning!' },
          { speaker: 'Tom', text: 'Hallo!', en: 'Hi!', audio: 'audio/dialog-intro-02.mp3' },
          { speaker: 'Zora', text: 'Tschüss!', en: 'Bye!' },
        ],
      },
    },
    vocab: [
      { id: 'hallo', de: 'Hallo! / Hoi! (informal)', en: 'hi', pos: 'phrase', example: { de: 'Hallo Anna!', en: 'Hi Anna!' }, gswZh: 'Hoi! / Sali!', gswBe: 'Hoi! / Sälü!' },
      { id: 'tisch', de: 'Tisch', en: 'table', pos: 'noun', gender: 'm', plural: 'Tische', audio: 'audio/my-own.mp3' },
    ],
    exercises: [
      ...exercises('a1-u1'),
      { ...base, id: 'a1-u1-lis-dialog', type: 'mcq', skill: 'listening', prompt: 'Listen to the intro dialogue. Who is Tom?', options: ['a', 'b'], answer: 1 },
      { ...base, id: 'a1-u1-lis-reto', type: 'mcq', skill: 'listening', variety: 'gsw-zh', prompt: 'Reto asks: "Wie gaats?" What does he mean?', options: ['a', 'b'], answer: 0 },
    ],
  });
}

describe('manifest', () => {
  it('lists dialogue lines, vocab, dictation, speak and listening stimuli with stable names', () => {
    richUnit();
    const u = loadContent(f.content, f.root).units[0]!;
    const m = buildManifest(u.unit, 'a1/unit-01');
    expect(m.unitId).toBe('a1-u01');
    expect(m.entries.map((e) => e.file)).toEqual([
      'dialog-intro-01.mp3', 'dialog-intro-02.mp3', 'dialog-intro-03.mp3',
      'dialog-swiss-01.mp3',
      'vocab-hallo.mp3', 'vocab-hallo-ex.mp3', 'vocab-hallo-zh.mp3', 'vocab-hallo-be.mp3', 'vocab-tisch.mp3',
      'ex-a1-u1-dict.mp3', 'ex-a1-u1-speak.mp3', 'ex-a1-u1-lis-reto.mp3',
    ]);
    const by = Object.fromEntries(m.entries.map((e) => [e.file, e]));
    expect(by['dialog-intro-01.mp3']).toMatchObject({ voice: 'de-f', speaker: 'Frau Keller', referenced: false, source: { file: 'unit.yaml', pointer: ['intro', 'dialogue', 0, 'audio'] } });
    expect(by['dialog-intro-02.mp3']).toMatchObject({ voice: 'de-m', referenced: true, path: 'audio/dialog-intro-02.mp3' });
    expect(by['dialog-intro-03.mp3']!.voiceGuessed).toBe(true);
    expect(by['dialog-swiss-01.mp3']).toMatchObject({ voice: 'zh-m', variety: 'gsw-zh', speaker: 'Reto' });
    expect(by['vocab-hallo.mp3']).toMatchObject({ text: 'Hallo! / Hoi!', note: 'informal', source: { file: 'vocab.yaml', id: 'hallo', pointer: [0, 'audio'] } });
    expect(by['vocab-hallo-ex.mp3']).toMatchObject({ text: 'Hallo Anna!', source: { pointer: [0, 'example', 'audio'] } });
    expect(by['vocab-hallo-zh.mp3']).toMatchObject({ variety: 'gsw-zh', voice: 'zh-f', text: 'Hoi! / Sali!', source: { pointer: [0, 'gswZhAudio'] } });
    expect(by['vocab-hallo-be.mp3']).toMatchObject({ variety: 'gsw-be', voice: 'be-f', source: { pointer: [0, 'gswBeAudio'] } });
    expect(by['vocab-tisch.mp3']).toMatchObject({ referenced: false, current: 'audio/my-own.mp3' });
    expect(by['ex-a1-u1-dict.mp3']).toMatchObject({ kind: 'dictation', text: 'Hallo Anna.', source: { file: 'exercises.yaml', pointer: [4, 'audio'] } });
    expect(by['ex-a1-u1-lis-reto.mp3']).toMatchObject({ kind: 'listening', text: 'Wie gaats?', voice: 'zh-m', speaker: 'Reto' });
  });
  it('is deterministic and renders a script with every file', () => {
    richUnit();
    const u = loadContent(f.content, f.root).units[0]!;
    const a = buildManifest(u.unit, 'a1/unit-01');
    expect(JSON.stringify(buildManifest(u.unit, 'a1/unit-01'))).toBe(JSON.stringify(a));
    const md = renderScript(a);
    expect(md).toMatch(/^# Audio script: A1 unit 1 "Hallo!" \(a1-u01\)/);
    for (const e of a.entries) expect(md).toContain(`\`${e.file}\``);
    expect(md).toMatch(/\| de-f \| 4 \| Frau Keller, Zora \|/);
  });
  it('helpers', () => {
    expect(speakerGender('Frau Huber')).toBe('f');
    expect(speakerGender('Herr Meier')).toBe('m');
    expect(speakerGender('Verkäuferin')).toBe('f');
    expect(speakerGender('Ärztin')).toBe('f');
    expect(speakerGender('Zora')).toBeUndefined();
    expect(voiceFor('de', 'f')).toBe('de-f');
    expect(voiceFor('ch-std', 'm')).toBe('zh-m');
    expect(voiceFor('gsw-be', 'f')).toBe('be-f');
    expect(readingText('Grüezi! (to one person)')).toEqual({ text: 'Grüezi!', note: 'to one person' });
    expect(quoted('Sandra asks: "Vo wo chunnsch?" and „Hoi“')).toBe('Vo wo chunnsch? Hoi');
    expect(quoted('Listen again.')).toBeUndefined();
  });
});

describe('audio:scripts', () => {
  it('writes manifest and script per unit, then --check passes; detects stale files', () => {
    writeUnit(f, 'A1', 1);
    writeUnit(f, 'A1', 2);
    const r = exportScripts(f.content, { root: f.root });
    expect(r.ok).toBe(true);
    expect(r.changed).toHaveLength(4);
    const manifest = JSON.parse(readFileSync(join(unitDir(1), 'audio-manifest.json'), 'utf8')) as { folder: string; entries: unknown[] };
    expect(manifest.folder).toBe('a1/unit-01');
    expect(existsSync(join(unitDir(2), 'audio-script.md'))).toBe(true);
    expect(exportScripts(f.content, { root: f.root, check: true })).toMatchObject({ ok: true, changed: [] });
    writeFileSync(join(unitDir(1), 'audio-script.md'), 'old');
    const c = exportScripts(f.content, { root: f.root, check: true });
    expect(c.ok).toBe(false);
    expect(c.changed).toEqual(['content/a1/unit-01/audio-script.md']);
    expect(readFileSync(join(unitDir(1), 'audio-script.md'), 'utf8')).toBe('old');
  });
});

describe('audio:link', () => {
  const yamlWithComments = `# Unit vocab — keep this comment
- id: hallo-1
  de: Hallo
  en: hello # inline comment
  pos: phrase
  example: { de: "Hallo Anna!", en: "Hi Anna!" }

- id: tisch-1 # the table
  de: Tisch
  en: table
  pos: noun
  gender: m
  plural: Tische
  tags: [furniture]
`;
  it('writes audio fields for existing files only, preserving comments and formatting', () => {
    writeUnit(f, 'A1', 1, { vocab: yamlWithComments });
    mkdirSync(join(unitDir(), 'audio'), { recursive: true });
    for (const n of ['vocab-tisch-1', 'dialog-intro-01', 'dialog-swiss-01', 'ex-a1-u1-dict', 'vocab-hallo-1-ex']) writeFileSync(join(unitDir(), 'audio', `${n}.mp3`), 'x');
    const before = readFileSync(join(unitDir(), 'unit.yaml'), 'utf8');

    const dry = linkAudio(f.content, { root: f.root, dryRun: true });
    expect(dry.changes).toHaveLength(5);
    expect(readFileSync(join(unitDir(), 'vocab.yaml'), 'utf8')).toBe(yamlWithComments);

    const r = linkAudio(f.content, { root: f.root });
    expect(r.ok).toBe(true);
    expect(r.changes.map((c) => c.to).sort()).toEqual(['audio/dialog-intro-01.mp3', 'audio/dialog-swiss-01.mp3', 'audio/ex-a1-u1-dict.mp3', 'audio/vocab-hallo-1-ex.mp3', 'audio/vocab-tisch-1.mp3']);
    expect(readFileSync(join(unitDir(), 'vocab.yaml'), 'utf8')).toBe(
      yamlWithComments
        .replace('en: "Hi Anna!" }', 'en: "Hi Anna!", audio: audio/vocab-hallo-1-ex.mp3 }')
        .replace('  tags: [furniture]\n', '  tags: [furniture]\n  audio: audio/vocab-tisch-1.mp3\n'),
    );
    const after = readFileSync(join(unitDir(), 'unit.yaml'), 'utf8');
    expect(after.split('\n').length).toBe(before.split('\n').length + 2);
    const u = loadContent(f.content, f.root).units[0]!.unit;
    expect(u.intro.dialogue[0]!.audio).toBe('audio/dialog-intro-01.mp3');
    expect(u.exercises.find((e) => e.id === 'a1-u1-dict')!.audio).toBe('audio/ex-a1-u1-dict.mp3');
    // Idempotent.
    expect(linkAudio(f.content, { root: f.root }).changes).toEqual([]);
  });
  it('keeps hand-set paths to existing files unless --force, and replaces dangling ones', () => {
    writeUnit(f, 'A1', 1, {
      vocab: [{ ...vocab[0], id: 'hallo', audio: 'audio/custom.mp3' }, { ...vocab[1], id: 'tisch', audio: 'audio/gone.mp3' }],
    });
    mkdirSync(join(unitDir(), 'audio'), { recursive: true });
    for (const n of ['custom', 'vocab-hallo', 'vocab-tisch']) writeFileSync(join(unitDir(), 'audio', `${n}.mp3`), 'x');
    const r = linkAudio(f.content, { root: f.root });
    expect(r.changes.map((c) => [c.from, c.to])).toEqual([['audio/gone.mp3', 'audio/vocab-tisch.mp3']]);
    expect(r.skipped[0]).toMatch(/keeps audio\/custom\.mp3/);
    const forced = linkAudio(f.content, { root: f.root, force: true });
    expect(forced.changes.map((c) => c.to)).toEqual(['audio/vocab-hallo.mp3']);
  });
});

describe('build-packs audio', () => {
  it('copies referenced audio and opus siblings to packs/audio/<level>/<unitId>/', () => {
    const ex = exercises('a1-u1');
    (ex[4] as Record<string, unknown>).audio = 'audio/ex-a1-u1-dict.mp3';
    (ex[5] as Record<string, unknown>).audio = 'audio/missing.mp3';
    (ex[0] as Record<string, unknown>).audio = 'https://cdn.example.org/x.mp3';
    writeUnit(f, 'A1', 1, { exercises: ex });
    mkdirSync(join(unitDir(), 'audio'), { recursive: true });
    writeFileSync(join(unitDir(), 'audio', 'ex-a1-u1-dict.mp3'), 'mp3');
    writeFileSync(join(unitDir(), 'audio', 'ex-a1-u1-dict.opus'), 'opus');
    writeFileSync(join(unitDir(), 'audio', 'unreferenced.mp3'), 'x');
    mkdirSync(join(f.out, 'audio', 'b2'), { recursive: true });
    writeFileSync(join(f.out, 'audio', 'b2', 'stale.mp3'), 'x');

    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.2.0', root: f.root });
    expect(r.ok).toBe(true);
    expect(r.audio).toEqual(['audio/a1/a1-u01/audio/ex-a1-u1-dict.mp3', 'audio/a1/a1-u01/audio/ex-a1-u1-dict.opus']);
    expect(readFileSync(join(f.out, 'audio/a1/a1-u01/audio/ex-a1-u1-dict.opus'), 'utf8')).toBe('opus');
    expect(existsSync(join(f.out, 'audio', 'b2'))).toBe(false);
    expect(r.log).toMatch(/audio: 2 file\(s\) copied; audio coverage: 1\/\d+/);
  });
  it('copies and counts example, Zurich and Bernese vocab audio', () => {
    writeUnit(f, 'A1', 1, {
      vocab: [{ id: 'hallo', de: 'Hallo', en: 'hi', pos: 'phrase', example: { de: 'Hallo Anna!', en: 'Hi Anna!', audio: 'audio/vocab-hallo-ex.mp3' }, gswZh: 'Hoi', gswZhAudio: 'audio/vocab-hallo-zh.mp3', gswBe: 'Sälü', gswBeAudio: 'audio/vocab-hallo-be.mp3' }],
    });
    mkdirSync(join(unitDir(), 'audio'), { recursive: true });
    for (const n of ['ex', 'zh', 'be']) writeFileSync(join(unitDir(), 'audio', `vocab-hallo-${n}.mp3`), 'x');
    const lint = lintContent(f.content, f.root);
    expect(lint.warnings).toBe(0);
    // Slots: intro + swiss + word + example + zh + be + dictation + speak = 8.
    expect(lint.audio).toEqual({ recorded: 3, total: 8 });
    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.2.0', root: f.root });
    expect(r.audio).toEqual(['audio/a1/a1-u01/audio/vocab-hallo-be.mp3', 'audio/a1/a1-u01/audio/vocab-hallo-ex.mp3', 'audio/a1/a1-u01/audio/vocab-hallo-zh.mp3']);
  });
});

describe('lint: audio coverage, review sign-off, mcq positions', () => {
  it('reports coverage and review status as info, not warnings, before v1.0', () => {
    writeUnit(f, 'A1', 1, { unit: { review: { de: 'K. Huber', ch: 'R. Meier', date: '2026-10-01' } } });
    writeUnit(f, 'A1', 2, { unit: { review: { de: 'K. Huber' } } });
    writeUnit(f, 'A1', 3);
    mkdirSync(join(unitDir(1), 'audio'), { recursive: true });
    writeFileSync(join(unitDir(1), 'audio', 'dialog-intro-01.mp3'), 'x');
    writeUnit(f, 'A1', 1, { unit: { review: { de: 'K. Huber', ch: 'R. Meier' }, intro: { scene: 's', dialogue: [{ speaker: 'Anna', text: 'Hallo!', en: 'Hi!', audio: 'audio/dialog-intro-01.mp3' }] } } });
    const r = lintContent(f.content, f.root);
    expect(r.warnings).toBe(0);
    expect(r.review).toEqual([
      { unitId: 'a1-u01', de: true, ch: true },
      { unitId: 'a1-u02', de: true, ch: false },
      { unitId: 'a1-u03', de: false, ch: false },
    ]);
    // Slots per fixture unit: 1 intro + 1 swiss + 2 vocab + dictation + speak = 6.
    expect(r.audio).toEqual({ recorded: 1, total: 18 });
    expect(r.info).toEqual([
      'audio coverage: 1/18 (6%)',
      'review sign-off: 1/3 unit(s); missing review.de: a1-u03; missing review.ch: a1-u02, a1-u03',
    ]);
    const strict = lintContent(f.content, f.root, { strictReview: true });
    expect(strict.issues.filter((i) => i.severity === 'warning').map((i) => `${i.file} ${i.message}`)).toEqual([
      'content/a1/unit-02/unit.yaml native review sign-off missing: review.ch',
      'content/a1/unit-03/unit.yaml native review sign-off missing: review.de and review.ch',
    ]);
  });
  it('warns when every mcq in a unit has answer 0', () => {
    const mcq = (id: string, answer: number) => ({ ...base, id, type: 'mcq', skill: 'reading', options: ['a', 'b', 'c'], answer });
    writeUnit(f, 'A1', 1, { exercises: [...exercises('a1-u1'), mcq('m2', 0), mcq('m3', 0)] });
    writeUnit(f, 'A1', 2, { exercises: [...exercises('a1-u2'), mcq('n2', 2)] });
    const warns = lintContent(f.content, f.root).issues.filter((i) => i.severity === 'warning');
    expect(warns.map((w) => `${w.file} ${w.message}`)).toEqual([
      'content/a1/unit-01/exercises.yaml all 3 mcq items have answer: 0; vary the position of the correct option',
    ]);
  });
  it('does not warn about remote audio URLs', () => {
    const ex = exercises('a1-u1');
    (ex[4] as Record<string, unknown>).audio = 'https://cdn.example.org/a.mp3';
    writeUnit(f, 'A1', 1, { exercises: ex, unit: unitYaml('A1', 1) });
    const r = lintContent(f.content, f.root);
    expect(r.warnings).toBe(0);
    expect(r.audio.recorded).toBe(1);
  });
});

const ffmpeg = findFfmpeg();
describe.skipIf(!ffmpeg)('audio:process (needs ffmpeg)', () => {
  it('trims, normalises and encodes mp3 + opus into the unit audio folder', () => {
    writeUnit(f, 'A1', 1);
    writeUnit(f, 'A1', 2);
    const raw = join(f.root, 'raw');
    mkdirSync(join(raw, 'a1', 'unit-01'), { recursive: true });
    const wav = join(raw, 'a1', 'unit-01', 'dialog-intro-01.wav');
    // 0.6 s silence, 1 s quiet tone, 0.8 s silence.
    const g = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-af', 'volume=0.05,adelay=600,apad=pad_dur=0.8', wav]);
    expect(g.status).toBe(0);
    writeFileSync(join(raw, 'dialog-intro-01.wav'), readFileSync(wav)); // ambiguous at the top level
    writeFileSync(join(raw, 'vocab-hallo-1.wav'), readFileSync(wav)); // unique: unit 1 only
    writeFileSync(join(raw, 'not-in-manifest.wav'), readFileSync(wav));

    const r = processAudio({ contentDir: f.content, inDir: raw, root: f.root });
    expect(r.ok).toBe(true);
    expect(r.processed).toEqual(['a1/unit-01/audio/dialog-intro-01', 'a1/unit-01/audio/vocab-hallo-1']);
    expect(r.log).toMatch(/skip dialog-intro-01\.wav: .* a1\/unit-01, a1\/unit-02/);
    expect(r.log).toMatch(/skip not-in-manifest\.wav/);
    for (const ext of ['mp3', 'opus']) {
      const out = join(unitDir(1), 'audio', `dialog-intro-01.${ext}`);
      expect(statSync(out).size).toBeGreaterThan(1000);
      const probe = spawnSync(ffmpeg!.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration:stream=channels', '-of', 'json', out], { encoding: 'utf8' });
      if (probe.status === 0) {
        const j = JSON.parse(probe.stdout) as { format: { duration: string }; streams: Array<{ channels: number }> };
        expect(j.streams[0]!.channels).toBe(1);
        expect(Number(j.format.duration)).toBeLessThan(1.8); // silence trimmed from 2.4 s
      }
    }
    const meas = spawnSync(ffmpeg!, ['-hide_banner', '-nostats', '-i', join(unitDir(1), 'audio', 'dialog-intro-01.mp3'), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
    const loud = Number(/"input_i" : "(-?[\d.]+)"/.exec(meas.stderr)![1]);
    expect(Math.abs(loud - -16)).toBeLessThan(1.5);

    // Second run: up to date, nothing re-encoded.
    expect(processAudio({ contentDir: f.content, inDir: raw, root: f.root }).processed).toEqual([]);
    // --unit maps top-level files to that unit.
    const u2 = processAudio({ contentDir: f.content, inDir: raw, root: f.root, unit: 'a1/unit-02', force: true });
    expect(u2.processed).toContain('a1/unit-02/audio/dialog-intro-01');
    // Then audio:link picks the files up.
    expect(linkAudio(f.content, { root: f.root }).changes.length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe('audio:process without ffmpeg', () => {
  it('skips cleanly', () => {
    const r = processAudio({ contentDir: f.content, inDir: join(f.root, 'nope'), root: f.root, ffmpeg: null });
    expect(r).toMatchObject({ ok: true, skipped: true, processed: [] });
    expect(r.log).toMatch(/ffmpeg not found/);
  });
});
