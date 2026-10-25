import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PronunciationPack } from '@doppelpunkt/content-schema';
import { linkAudio } from '../src/audio-link';
import { findFfmpeg, processAudio } from '../src/audio-process';
import { spawnSync } from 'node:child_process';
import { exportScripts } from '../src/audio-scripts';
import { buildPacks } from '../src/build-packs';
import { lintContent } from '../src/lint';
import { buildPronunciationManifest, loadDrills, renderPronunciationScript } from '../src/pronunciation';
import { buildReport, formatReport } from '../src/report';
import { makeFixture, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const pron = (rel = '') => join(f.content, 'pronunciation', rel);

function drill(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: 'ü vs u',
    ipa: ['y', 'u'],
    explanation: 'Say **ee** and round your lips.',
    pairs: [
      [{ text: 'Mütter', en: 'mothers' }, { text: 'Mutter', en: 'mother' }],
      [{ text: 'Tür', en: 'door' }, { text: 'Tour', en: 'tour' }],
    ],
    words: [{ text: 'fünf', en: 'five' }, { text: 'müde', en: 'tired' }],
    sentences: [{ text: 'Die Tür ist grün.', en: 'The door is green.' }],
    ...over,
  };
}
const writeDrill = (id: string, over: Record<string, unknown> = {}, file = `${id}.yaml`) => f.write(`pronunciation/${file}`, drill(id, over));
const messages = () => lintContent(f.content, f.root).issues.map((i) => `${i.severity} ${i.file}: ${i.message}`);

describe('pronunciation drills: load and lint', () => {
  it('loads valid drills with defaults and no issues', () => {
    writeDrill('ue-u');
    writeDrill('ich-ach', { title: 'ich-Laut vs ach-Laut', pairs: [[{ text: 'Dächer', en: 'roofs' }, { text: 'Dach', en: 'roof' }]] });
    const r = loadDrills(f.content, f.root);
    expect(r.issues).toEqual([]);
    expect(r.drills.map((d) => d.drill.id)).toEqual(['ich-ach', 'ue-u']);
    expect(r.drills[1]!.drill).toMatchObject({ level: 'A1', variety: 'de', tips: [], commonMistakes: [] });
    const lint = lintContent(f.content, f.root);
    expect(lint.errors).toBe(0);
    expect(lint.issues).toEqual([]);
    expect(lint.drills).toHaveLength(2);
    expect(lint.info.join('\n')).toMatch(/pronunciation: 2 drill\(s\), audio coverage 0\/12/);
  });
  it('requires the file name to equal the id', () => {
    writeDrill('ue-u', {}, 'umlaut.yaml');
    expect(messages()).toEqual([expect.stringMatching(/error content\/pronunciation\/umlaut.yaml: id is "ue-u" but the file is named umlaut.yaml/)]);
  });
  it('reports schema errors with a readable path', () => {
    writeDrill('bad', { words: [] , explanation: '' });
    const m = messages();
    expect(m.some((x) => /bad.yaml: words: .*at least 1/i.test(x))).toBe(true);
    expect(m.some((x) => /bad.yaml: explanation/.test(x))).toBe(true);
  });
  it('flags identical pair words, empty texts and glosses, duplicates and unknown fields', () => {
    writeDrill('x', {
      pairs: [
        [{ text: 'Rad', en: 'wheel' }, { text: 'rad', en: 'wheel' }],
        [{ text: 'Rat', en: 'advice' }, { text: 'Rad', en: 'wheel' }],
        [{ text: 'Rad', en: 'wheel' }, { text: 'Rat', en: 'advice' }],
      ],
      words: [{ text: ' ', en: 'nothing' }, { text: 'Bad', en: '' }, { text: 'bad', en: 'bath' }],
      sentence: [{ text: 'typo', en: 'typo' }],
    });
    const m = messages().join('\n');
    expect(m).toMatch(/error .*pairs\[0\]: "Rad" and "rad" are the same word/);
    expect(m).toMatch(/warning .*pairs\[2\]: repeats pairs\[1\]/);
    expect(m).toMatch(/error .*words\[0\]: text is empty/);
    expect(m).toMatch(/error .*words\[1\]: en \(English gloss\) is empty/);
    expect(m).toMatch(/warning .*words\[2\]: "bad" repeats words\[1\]/);
    expect(m).toMatch(/warning .*unknown field\(s\) ignored: sentence/);
  });
  it('warns when the speech grader cannot tell a pair apart', () => {
    writeDrill('x', { variety: 'gsw-zh', pairs: [[{ text: 'Grüezi', en: 'hello' }, { text: 'Grüezzi', en: 'hello' }]], words: [{ text: 'Grüezi', en: 'hello' }], sentences: [] });
    expect(messages().join('\n')).toMatch(/warning .*pairs\[0\]: the speech grader accepts "Grüezi" and "Grüezzi" for each other/);
  });
  it('flags duplicate ids across .yaml and .yml files', () => {
    writeDrill('ue-u');
    writeDrill('ue-u', {}, 'ue-u.yml');
    expect(messages().join('\n')).toMatch(/duplicate drill id "ue-u"/);
  });
  it('warns about a drill without pairs and about missing audio files', () => {
    writeDrill('r', { pairs: [], words: [{ text: 'rot', en: 'red', audio: 'audio/pron-r-word-01.mp3' }], sentences: [] });
    const m = messages().join('\n');
    expect(m).toMatch(/warning .*no minimal pairs/);
    expect(m).toMatch(/warning .*words\[0\]: audio file audio\/pron-r-word-01.mp3 does not exist yet \(paths are relative to content\/pronunciation\/r\/\)/);
    expect(lintContent(f.content, f.root).errors).toBe(0);
  });
  it('ignores the generated manifest and script files', () => {
    writeDrill('ue-u');
    exportScripts(f.content, { root: f.root });
    expect(existsSync(pron('audio-manifest.json'))).toBe(true);
    expect(loadDrills(f.content, f.root).drills).toHaveLength(1);
    expect(lintContent(f.content, f.root).issues).toEqual([]);
  });
});

describe('pronunciation drills: build', () => {
  const opts = () => ({ contentDir: f.content, outDir: f.out, version: '0.3.0', root: f.root });
  it('writes an empty pronunciation pack when there are no drills', () => {
    const r = buildPacks(opts());
    expect(r.ok).toBe(true);
    expect(r.written).toContain('pronunciation.json');
    const pack = PronunciationPack.parse(JSON.parse(readFileSync(join(f.out, 'pronunciation.json'), 'utf8')));
    expect(pack).toEqual({ version: '0.3.0', builtAt: '1970-01-01T00:00:00.000Z', drills: [] });
  });
  it('compiles drills sorted by id, deterministically', () => {
    writeUnit(f, 'A1', 1);
    writeDrill('ue-u');
    writeDrill('ach', { title: 'ach-Laut', pairs: [[{ text: 'Bach', en: 'stream' }, { text: 'back', en: 'bake!' }]] });
    expect(buildPacks(opts()).ok).toBe(true);
    const first = readFileSync(join(f.out, 'pronunciation.json'), 'utf8');
    const pack = PronunciationPack.parse(JSON.parse(first));
    expect(pack.drills.map((d) => d.id)).toEqual(['ach', 'ue-u']);
    expect(pack.builtAt).not.toBe('1970-01-01T00:00:00.000Z');
    buildPacks(opts());
    expect(readFileSync(join(f.out, 'pronunciation.json'), 'utf8')).toBe(first);
    buildPacks({ ...opts(), builtAt: '2026-01-01T00:00:00.000Z' });
    expect(JSON.parse(readFileSync(join(f.out, 'pronunciation.json'), 'utf8')).builtAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('refuses to build when a drill has errors', () => {
    writeDrill('ue-u', {}, 'wrong-name.yaml');
    const r = buildPacks(opts());
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/wrong-name.yaml/);
  });
  it('copies referenced drill audio and opus siblings to packs/audio/pronunciation/<id>/', () => {
    writeDrill('ue-u', { words: [{ text: 'fünf', en: 'five', audio: 'audio/pron-ue-u-word-01.mp3' }, { text: 'müde', en: 'tired', audio: 'audio/missing.mp3' }] });
    mkdirSync(pron('ue-u/audio'), { recursive: true });
    writeFileSync(pron('ue-u/audio/pron-ue-u-word-01.mp3'), 'mp3');
    writeFileSync(pron('ue-u/audio/pron-ue-u-word-01.opus'), 'opus');
    const r = buildPacks(opts());
    expect(r.ok).toBe(true);
    expect(r.audio).toEqual(['audio/pronunciation/ue-u/audio/pron-ue-u-word-01.mp3', 'audio/pronunciation/ue-u/audio/pron-ue-u-word-01.opus']);
    expect(readFileSync(join(f.out, 'audio/pronunciation/ue-u/audio/pron-ue-u-word-01.opus'), 'utf8')).toBe('opus');
    expect(r.log).toMatch(/pronunciation audio: 1\/7/);
  });
});

describe('pronunciation drills: audio pipeline', () => {
  it('builds a manifest with stable names, same voice per pair and alternating voices', () => {
    writeDrill('ue-u');
    writeDrill('swiss-ch', { title: 'Swiss ch', variety: 'gsw-zh', pairs: [], words: [{ text: 'Chuchichäschtli', en: 'kitchen cupboard' }], sentences: [] });
    const m = buildPronunciationManifest(loadDrills(f.content, f.root).drills);
    expect(m.drills.map((d) => d.id)).toEqual(['swiss-ch', 'ue-u']);
    expect(m.entries.map((e) => [e.file, e.voice, e.text])).toEqual([
      ['pron-swiss-ch-word-01.mp3', 'zh-f', 'Chuchichäschtli'],
      ['pron-ue-u-pair-01-a.mp3', 'de-f', 'Mütter'],
      ['pron-ue-u-pair-01-b.mp3', 'de-f', 'Mutter'],
      ['pron-ue-u-pair-02-a.mp3', 'de-m', 'Tür'],
      ['pron-ue-u-pair-02-b.mp3', 'de-m', 'Tour'],
      ['pron-ue-u-word-01.mp3', 'de-f', 'fünf'],
      ['pron-ue-u-word-02.mp3', 'de-m', 'müde'],
      ['pron-ue-u-sentence-01.mp3', 'de-f', 'Die Tür ist grün.'],
    ]);
    expect(m.entries[1]).toMatchObject({ path: 'audio/pron-ue-u-pair-01-a.mp3', kind: 'pron-pair', drill: 'ue-u', source: { file: 'ue-u.yaml', pointer: ['pairs', 0, 0, 'audio'] }, referenced: false });
    const script = renderPronunciationScript(m);
    expect(script).toMatch(/## ü vs u \(ue-u, de\)/);
    expect(script).toMatch(/\| `pron-ue-u-pair-01-a.mp3` \| de-f \| Mütter \| mothers \|  \|/);
  });
  it('audio:scripts writes content/pronunciation/audio-manifest.json + audio-script.md; --check detects changes', () => {
    writeUnit(f, 'A1', 1);
    expect(exportScripts(f.content, { root: f.root }).pronunciation).toBeUndefined();
    expect(existsSync(pron())).toBe(false);
    writeDrill('ue-u');
    expect(exportScripts(f.content, { root: f.root, check: true })).toMatchObject({ ok: false, changed: ['content/pronunciation/audio-manifest.json', 'content/pronunciation/audio-script.md'] });
    const r = exportScripts(f.content, { root: f.root });
    expect(r.pronunciation!.entries).toHaveLength(7);
    expect(r.log).toMatch(/pronunciation: 1 drill\(s\), 7 recording\(s\), 0 linked/);
    expect(JSON.parse(readFileSync(pron('audio-manifest.json'), 'utf8')).entries).toHaveLength(7);
    expect(exportScripts(f.content, { root: f.root, check: true })).toMatchObject({ ok: true, changed: [] });
    writeDrill('ue-u', { words: [{ text: 'fünf', en: 'five' }] });
    expect(exportScripts(f.content, { root: f.root, check: true }).ok).toBe(false);
  });
  it('audio:link writes the audio fields of drill items whose files exist, keeping comments', () => {
    f.write('pronunciation/ue-u.yaml', [
      '# ü vs u',
      'id: ue-u',
      'title: ü vs u',
      'explanation: Round your lips.',
      'pairs:',
      '  - [{ text: Mütter, en: mothers }, { text: Mutter, en: mother }]',
      'words:',
      '  - text: fünf # five',
      '    en: five',
      '',
    ].join('\n'));
    mkdirSync(pron('ue-u/audio'), { recursive: true });
    for (const n of ['pair-01-a', 'pair-01-b', 'word-01']) writeFileSync(pron(`ue-u/audio/pron-ue-u-${n}.mp3`), 'x');
    const dry = linkAudio(f.content, { root: f.root, dryRun: true });
    expect(dry.changes).toHaveLength(3);
    expect(readFileSync(pron('ue-u.yaml'), 'utf8')).not.toMatch(/audio:/);
    const r = linkAudio(f.content, { root: f.root });
    expect(r.ok).toBe(true);
    const after = readFileSync(pron('ue-u.yaml'), 'utf8');
    expect(after).toMatch(/# ü vs u/);
    expect(after).toMatch(/text: fünf # five/);
    expect(after).toMatch(/\{ text: Mütter, en: mothers, audio: audio\/pron-ue-u-pair-01-a.mp3 \}/);
    const d = loadDrills(f.content, f.root).drills[0]!.drill;
    expect(d.pairs[0]![1].audio).toBe('audio/pron-ue-u-pair-01-b.mp3');
    expect(d.words[0]!.audio).toBe('audio/pron-ue-u-word-01.mp3');
    expect(linkAudio(f.content, { root: f.root }).changes).toEqual([]);
    expect(lintContent(f.content, f.root).drillAudio).toEqual({ recorded: 3, total: 3 });
    exportScripts(f.content, { root: f.root });
    expect(readFileSync(pron('audio-script.md'), 'utf8')).toMatch(/Total: 3 file\(s\) in 1 drill\(s\), 3 done/);
  });
  it('audio:process knows drill recordings (skips without ffmpeg, rejects unknown folders)', () => {
    writeDrill('ue-u');
    expect(processAudio({ contentDir: f.content, inDir: f.root, root: f.root, ffmpeg: null }).skipped).toBe(true);
    const bad = processAudio({ contentDir: f.content, inDir: f.root, root: f.root, ffmpeg: 'ffmpeg', unit: 'pronunciation/nope' });
    expect(bad.log).toMatch(/unknown unit pronunciation\/nope/);
    const raw = join(f.root, 'raw');
    mkdirSync(raw, { recursive: true });
    writeFileSync(join(raw, 'pron-ue-u-word-09.wav'), 'x');
    const r = processAudio({ contentDir: f.content, inDir: raw, root: f.root, ffmpeg: 'ffmpeg', unit: 'pronunciation/ue-u' });
    expect(r.log).toMatch(/"pron-ue-u-word-09" is not in any audio manifest/);
  });
  it('content:report lists drills with audio coverage', () => {
    writeUnit(f, 'A1', 1);
    writeDrill('ue-u');
    writeDrill('ach', { pairs: [[{ text: 'Bach', en: 'stream' }, { text: 'back', en: 'bake!' }]], sentences: [] });
    const r = buildReport(f.content, f.root);
    expect(r.drills).toEqual([
      { id: 'ach', title: 'ü vs u', level: 'A1', variety: 'de', pairs: 1, words: 2, sentences: 0, audio: { recorded: 0, total: 4 } },
      { id: 'ue-u', title: 'ü vs u', level: 'A1', variety: 'de', pairs: 2, words: 2, sentences: 1, audio: { recorded: 0, total: 7 } },
    ]);
    const text = formatReport(r);
    expect(text).toMatch(/Pronunciation drills/);
    expect(text).toMatch(/total\s+3\s+4\s+1\s+0\/11/);
  });
});

const ffmpeg = findFfmpeg();
describe.skipIf(!ffmpeg)('pronunciation audio:process (needs ffmpeg)', () => {
  it('processes a drill recording into content/pronunciation/<id>/audio/, then link and build pick it up', () => {
    writeDrill('ue-u');
    const raw = join(f.root, 'raw');
    mkdirSync(raw, { recursive: true });
    const wav = join(raw, 'pron-ue-u-pair-01-a.wav');
    const g = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', '-af', 'volume=0.05', wav]);
    expect(g.status).toBe(0);
    const r = processAudio({ contentDir: f.content, inDir: raw, root: f.root });
    expect(r.ok).toBe(true);
    expect(r.processed).toEqual(['pronunciation/ue-u/audio/pron-ue-u-pair-01-a']);
    expect(existsSync(pron('ue-u/audio/pron-ue-u-pair-01-a.opus'))).toBe(true);
    expect(linkAudio(f.content, { root: f.root }).changes).toHaveLength(1);
    const b = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.3.0', root: f.root });
    expect(b.audio).toEqual(['audio/pronunciation/ue-u/audio/pron-ue-u-pair-01-a.mp3', 'audio/pronunciation/ue-u/audio/pron-ue-u-pair-01-a.opus']);
  });
});
