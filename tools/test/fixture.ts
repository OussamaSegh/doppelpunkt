import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';

export function unitYaml(level: string, n: number, over: Record<string, unknown> = {}) {
  return {
    id: `${level.toLowerCase()}-u${String(n).padStart(2, '0')}`,
    level,
    number: n,
    title: 'Hallo!',
    titleEn: 'Hello!',
    goal: 'By the end you can greet people.',
    canDo: ['I can say hello.'],
    intro: { scene: 'At the station.', dialogue: [{ speaker: 'Anna', text: 'Hallo!', en: 'Hello!' }] },
    grammar: [{ id: `greetings-${level.toLowerCase()}-${n}`, title: 'Greetings', body: 'Say **Hallo**.' }],
    swiss: {
      scene: 'Zürich HB.',
      dialogue: [{ speaker: 'Reto', text: 'Grüezi!', en: 'Hello!', variety: 'gsw-zh' }],
      notes: ['Grüezi is the polite greeting.'],
    },
    ...over,
  };
}

export const vocab = [
  { id: 'hallo', de: 'Hallo', en: 'hello', pos: 'phrase' },
  { id: 'tisch', de: 'Tisch', en: 'table', pos: 'noun', gender: 'm', plural: 'Tische' },
];

const base = { prompt: 'Do it.', explanation: 'Because.' };
export function exercises(prefix: string) {
  return [
    { ...base, id: `${prefix}-mcq`, type: 'mcq', skill: 'reading', options: ['der', 'die'], answer: 0 },
    { ...base, id: `${prefix}-gap`, type: 'gap', skill: 'grammar', text: 'Das ist ___ Tisch.', answers: [['der']] },
    { ...base, id: `${prefix}-ord`, type: 'order', skill: 'writing', tokens: ['Ich', 'heisse', 'Anna'], answers: ['Ich heisse Anna.'] },
    { ...base, id: `${prefix}-match`, type: 'match', skill: 'vocabulary', pairs: [['Hallo', 'Hello'], ['Tisch', 'table']] },
    { ...base, id: `${prefix}-dict`, type: 'dictation', skill: 'listening', transcript: 'Hallo Anna.' },
    { ...base, id: `${prefix}-speak`, type: 'speak', skill: 'speaking', target: 'Hallo!' },
    { ...base, id: `${prefix}-gsw`, type: 'transform', skill: 'vocabulary', variety: 'gsw-zh', from: 'de', to: 'gsw-zh', source: 'Guten Tag', answers: ['Grüezi'] },
  ];
}

export type Fixture = { root: string; content: string; out: string; write: (rel: string, data: unknown) => void; cleanup: () => void };

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'dp-content-'));
  const content = join(root, 'content');
  const out = join(root, 'out');
  mkdirSync(content, { recursive: true });
  const write = (rel: string, data: unknown) => {
    const p = join(content, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof data === 'string' ? data : stringify(data));
  };
  return { root, content, out, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Write a complete valid unit. */
export function writeUnit(f: Fixture, level: string, n: number, opts: { unit?: Record<string, unknown>; vocab?: unknown; exercises?: unknown } = {}) {
  const dir = `${level.toLowerCase()}/unit-${String(n).padStart(2, '0')}`;
  f.write(`${dir}/unit.yaml`, unitYaml(level, n, opts.unit));
  f.write(`${dir}/vocab.yaml`, opts.vocab ?? vocab.map((v) => ({ ...v, id: `${v.id}-${n}` })));
  f.write(`${dir}/exercises.yaml`, opts.exercises ?? exercises(`${level.toLowerCase()}-u${n}`));
}
