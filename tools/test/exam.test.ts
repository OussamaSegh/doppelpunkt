import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LevelPack } from '@doppelpunkt/content-schema';
import { linkAudio } from '../src/audio-link';
import { exportScripts } from '../src/audio-scripts';
import { buildPacks } from '../src/build-packs';
import { buildExamManifest, examMinutes, loadExams } from '../src/exam';
import { lintContent } from '../src/lint';
import { buildReport, formatReport } from '../src/report';
import { setYamlString } from '../src/yaml-edit';
import { makeFixture, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const base = { prompt: 'Do it.', explanation: 'Because.' };
export function examYaml(over: Record<string, unknown> = {}) {
  return {
    id: 'a1-modelltest-1',
    level: 'A1',
    title: 'Modelltest A1',
    format: 'goethe',
    sections: [
      {
        id: 'hoeren', skill: 'listening', title: 'Hören', minutes: 20, instructions: 'Listen. Sie hören …',
        stimulus: { text: 'Anna: Hallo, ich bin Anna.\nTom: Hallo Anna!' },
        exercises: [
          { ...base, id: 'a1-mt1-h1', type: 'mcq', skill: 'listening', options: ['Anna', 'Tom', 'Reto'], answer: 0 },
          { ...base, id: 'a1-mt1-h2', type: 'mcq', skill: 'listening', prompt: 'Where is Tom from?', transcript: 'Tom: Ich komme aus Berlin.', options: ['Wien', 'Berlin'], answer: 1 },
        ],
      },
      {
        id: 'lesen', skill: 'reading', title: 'Lesen', minutes: 25, instructions: 'Read.',
        stimulus: { text: 'Ich heisse Anna.' },
        exercises: [{ ...base, id: 'a1-mt1-l1', type: 'gap', skill: 'reading', text: 'Sie heisst ___.', answers: [['Anna']] }],
        points: [2],
      },
      {
        id: 'schreiben', skill: 'writing', title: 'Schreiben', minutes: 20, instructions: 'Write.',
        exercises: [{ ...base, id: 'a1-mt1-s1', type: 'write', skill: 'writing', task: 'Write.', model: 'Hallo.', checklist: ['greeting'] }],
        points: [10],
      },
      {
        id: 'sprechen', skill: 'speaking', title: 'Sprechen', minutes: 15, instructions: 'Speak.',
        exercises: [{ ...base, id: 'a1-mt1-sp1', type: 'speak', skill: 'speaking', target: 'Ich heisse Anna.' }],
      },
    ],
    ...over,
  };
}
const write = (data: unknown, name = 'a1-modelltest-1') => f.write(`a1/exam/${name}.yaml`, data);
const messages = () => lintContent(f.content, f.root).issues.map((i) => `${i.severity} ${i.file}: ${i.message}`);

describe('exam lint', () => {
  it('loads a valid exam without errors or warnings', () => {
    writeUnit(f, 'A1', 1);
    write(examYaml());
    const r = lintContent(f.content, f.root);
    expect(r.issues.filter((i) => i.file.includes('exam'))).toEqual([]);
    expect(r.exams.map((e) => e.exam.id)).toEqual(['a1-modelltest-1']);
    expect(examMinutes(r.exams[0]!.exam)).toEqual({ written: 65, speaking: 15 });
    expect(r.info.some((l) => /^exams: 1 mock exam\(s\), audio coverage 0\/3/.test(l))).toBe(true);
  });
  it('warns about listening items without anything to hear, or with the transcript in the prompt', () => {
    writeUnit(f, 'A1', 1);
    const x = examYaml();
    const h = (x.sections as Array<Record<string, unknown>>)[0]!;
    delete h.stimulus;
    (h.exercises as Array<Record<string, unknown>>).push({ ...base, id: 'a1-mt1-h3', type: 'mcq', skill: 'listening', prompt: 'Anna: "Ich wohne in Bern." Where?', options: ['Bern', 'Wien'], answer: 0 });
    write(x);
    const m = messages().filter((y) => /listening item/.test(y));
    expect(m).toEqual([
      'warning content/a1/exam/a1-modelltest-1.yaml: sections[0] (id: hoeren).exercises[0] (id: a1-mt1-h1): listening item has no audio, no transcript and no stimulus; there is nothing to hear',
      'warning content/a1/exam/a1-modelltest-1.yaml: sections[0] (id: hoeren).exercises[2] (id: a1-mt1-h3): listening item quotes what is said in its prompt (shown on screen); move it to transcript: and keep a short question',
    ]);
  });
  it('reports schema errors, file name and level mismatches', () => {
    writeUnit(f, 'A1', 1);
    write({ ...examYaml(), sections: [] });
    write(examYaml({ id: 'other' }), 'wrong-name');
    write(examYaml({ id: 'b1-test', level: 'B1' }), 'b1-test');
    const m = messages();
    expect(m.some((x) => /a1-modelltest-1\.yaml: sections: Array must contain at least 1/.test(x))).toBe(true);
    expect(m.some((x) => /wrong-name\.yaml: id is "other" but the file is named wrong-name\.yaml/.test(x))).toBe(true);
    expect(m.some((x) => /b1-test\.yaml: level is B1 but the folder is a1\//.test(x))).toBe(true);
  });
  it('checks ids, points, items, minutes and the stored answers', () => {
    writeUnit(f, 'A1', 1);
    const x = examYaml();
    const [h, l, s, sp] = x.sections as Array<Record<string, unknown>>;
    (h!.exercises as Array<Record<string, unknown>>)[0]!.id = 'a1-u1-mcq'; // clashes with the unit
    (h!.exercises as Array<Record<string, unknown>>)[1]!.answer = 5;
    l!.points = [1, 2];
    (l!.exercises as Array<Record<string, unknown>>)[0]!.answers = [['Tom']];
    (l!.exercises as Array<Record<string, unknown>>)[0]!.text = 'Sie ___ heisst ___.';
    s!.minutes = 60;
    sp!.id = 'hoeren';
    sp!.minutes = 30;
    write(x);
    const m = messages().filter((y) => y.includes('exam'));
    const has = (re: RegExp) => expect(m.some((y) => re.test(y)), `${re} in\n${m.join('\n')}`).toBe(true);
    has(/error .*sections\[0\] \(id: hoeren\)\.exercises\[0\] \(id: a1-u1-mcq\): duplicate exercise id "a1-u1-mcq" \(also in content\/a1\/unit-01\/exercises\.yaml\)/);
    has(/error .*sections\[0\] \(id: hoeren\)\.exercises\[1\] \(id: a1-mt1-h2\): answer index 5 is out of range/);
    has(/error .*sections\[1\] \(id: lesen\): points has 2 entries but the section has 1 exercise/);
    has(/error .*sections\[1\] \(id: lesen\)\.exercises\[0\] \(id: a1-mt1-l1\): text has 2 gap\(s\)/);
    has(/error .*sections\[3\] \(id: hoeren\): duplicate section id/);
    has(/warning .*written papers \(listening \+ reading \+ writing\) take 105 min; A1 exams usually take 60–90 min/);
    has(/warning .*speaking takes 30 min; A1 speaking tests usually take 10–20 min/);
  });
  it('applies the exercise rules to exam items and warns about missing parts', () => {
    writeUnit(f, 'A1', 1);
    const x = examYaml();
    const sections = (x.sections as Array<Record<string, unknown>>).filter((s) => s.skill !== 'writing');
    (sections[1]!.exercises as Array<Record<string, unknown>>)[0] = { ...base, id: 'a1-mt1-l1', type: 'order', skill: 'reading', tokens: ['Ich', 'bin', 'Anna'], answers: ['Ich bin Tom.'] };
    write({ ...x, sections });
    const m = messages().filter((y) => y.includes('exam'));
    expect(m.some((y) => /a1-mt1-l1\): answers\[0\] "Ich bin Tom\." does not use exactly the tokens/.test(y))).toBe(true);
    expect(m.some((y) => /warning .*no writing section/.test(y))).toBe(true);
  });
  it('checks completeness and minimum time only for papers in an exam format', () => {
    writeUnit(f, 'A1', 1);
    const full = examYaml({ format: 'generic' });
    const short = { ...full, sections: full.sections.slice(0, 1) };
    write(short);
    expect(messages().filter((y) => y.includes('exam'))).toEqual([]);
    write({ ...short, format: 'telc' });
    const m = messages().filter((y) => y.includes('exam'));
    expect(m.some((y) => /no speaking section/.test(y))).toBe(true);
    expect(m.some((y) => /take 20 min; A1 exams usually take 60–90 min/.test(y))).toBe(true);
  });
  it('blocks the build on exam errors', () => {
    writeUnit(f, 'A1', 1);
    write({ ...examYaml(), passMark: 2 });
    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.4.0', root: f.root });
    expect(r.ok).toBe(false);
  });
});

describe('setYamlString in exam files', () => {
  it('adds a key to a map whose only entry is a block scalar', () => {
    const src = 'sections:\n  - id: hoeren\n    stimulus:\n      text: |\n        Anna: Hallo!\n        Tom: Hi!\n    exercises: []\n';
    const out = setYamlString(src, ['sections', 0, 'stimulus', 'audio'], 'audio/stimulus-hoeren.mp3');
    expect(out).toBe('sections:\n  - id: hoeren\n    stimulus:\n      audio: audio/stimulus-hoeren.mp3\n      text: |\n        Anna: Hallo!\n        Tom: Hi!\n    exercises: []\n');
    const seq = '- text: |\n    a\n    b\n';
    expect(setYamlString(seq, [0, 'audio'], 'x.mp3')).toBe('- audio: x.mp3\n  text: |\n    a\n    b\n');
  });
});

describe('exam pipeline', () => {
  it('builds exams into LevelPack.exams and copies exam audio to packs/audio/<level>/<exam id>/', () => {
    writeUnit(f, 'A1', 1);
    const x = examYaml();
    (x.sections[0] as Record<string, any>).stimulus.audio = 'audio/stimulus-hoeren.mp3';
    write(x);
    const dir = join(f.content, 'a1', 'exam', 'a1-modelltest-1', 'audio');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stimulus-hoeren.mp3'), 'mp3');
    writeFileSync(join(dir, 'stimulus-hoeren.opus'), 'opus');
    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.4.0', root: f.root });
    expect(r.ok).toBe(true);
    const pack = LevelPack.parse(JSON.parse(readFileSync(join(f.out, 'a1.json'), 'utf8')));
    expect(pack.exams.map((e) => e.id)).toEqual(['a1-modelltest-1']);
    expect(pack.exams[0]!.sections[0]!.stimulus!.audio).toBe('audio/stimulus-hoeren.mp3');
    expect(r.audio).toEqual(['audio/a1/a1-modelltest-1/audio/stimulus-hoeren.mp3', 'audio/a1/a1-modelltest-1/audio/stimulus-hoeren.opus']);
    expect(r.log).toMatch(/a1\.json: 1 unit\(s\), 7 exercise\(s\), 1 mock exam\(s\) with 5 item\(s\)/);
    expect(r.log).toMatch(/exam audio: 1\/3/);
  });
  it('writes the exam audio manifest and script, and audio:link fills the exam YAML', () => {
    writeUnit(f, 'A1', 1);
    write(examYaml());
    const s = exportScripts(f.content, { root: f.root });
    expect(s.ok).toBe(true);
    const mf = join(f.content, 'a1', 'exam', 'audio-manifest.json');
    const manifest = JSON.parse(readFileSync(mf, 'utf8')) as ReturnType<typeof buildExamManifest>;
    expect(manifest.folder).toBe('a1/exam');
    expect(manifest.entries.map((e) => [e.file, e.kind, e.voice, e.speaker ?? null])).toEqual([
      ['stimulus-hoeren.mp3', 'exam-stimulus', 'de-f', 'Anna'],
      ['ex-a1-mt1-h2.mp3', 'listening', 'de-m', 'Tom'],
      ['ex-a1-mt1-sp1.mp3', 'speak', 'de-f', null],
    ]);
    expect(manifest.entries[0]!.source).toEqual({ file: 'a1-modelltest-1.yaml', id: 'hoeren', pointer: ['sections', 0, 'stimulus', 'audio'] });
    expect(readFileSync(join(f.content, 'a1', 'exam', 'audio-script.md'), 'utf8')).toMatch(/# Audio script: A1 mock exams[\s\S]*`stimulus-hoeren\.mp3`/);
    expect(exportScripts(f.content, { root: f.root, check: true }).ok).toBe(true);
    // The manifest files are not mistaken for exams.
    expect(loadExams(f.content, f.root).issues).toEqual([]);

    const dir = join(f.content, 'a1', 'exam', 'a1-modelltest-1', 'audio');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stimulus-hoeren.mp3'), 'x');
    writeFileSync(join(dir, 'ex-a1-mt1-sp1.mp3'), 'x');
    const l = linkAudio(f.content, { root: f.root });
    expect(l.ok).toBe(true);
    expect(l.changes.map((c) => c.pointer.join('.'))).toEqual(['sections.0.stimulus.audio', 'sections.3.exercises.0.audio']);
    const y = parse(readFileSync(join(f.content, 'a1', 'exam', 'a1-modelltest-1.yaml'), 'utf8'));
    expect(y.sections[0].stimulus.audio).toBe('audio/stimulus-hoeren.mp3');
    expect(y.sections[3].exercises[0].audio).toBe('audio/ex-a1-mt1-sp1.mp3');
    expect(exportScripts(f.content, { root: f.root, check: true }).ok).toBe(false);
    expect(lintContent(f.content, f.root).examAudio).toEqual({ recorded: 2, total: 3 });
  });
  it('lists exams in content:report', () => {
    writeUnit(f, 'A1', 1);
    write(examYaml());
    const r = buildReport(f.content, f.root);
    expect(r.exams).toHaveLength(1);
    expect(r.exams[0]).toMatchObject({ id: 'a1-modelltest-1', sections: 4, items: 5, points: 15, written: 65, speaking: 15, audio: { recorded: 0, total: 3 } });
    const text = formatReport(r);
    expect(text).toMatch(/Mock exams\nexam +level +format/);
    expect(text).toMatch(/a1-modelltest-1 +A1 +goethe +4 +5 +15 +60% +65\+15 +0\/3 \(0%\) +H 2\/2p, L 1\/2p, S 1\/10p, Sp 1\/1p/);
  });
  it('ignores a level without an exam folder', () => {
    writeUnit(f, 'A1', 1);
    expect(existsSync(join(f.content, 'a1', 'exam'))).toBe(false);
    expect(lintContent(f.content, f.root).exams).toEqual([]);
  });
});
