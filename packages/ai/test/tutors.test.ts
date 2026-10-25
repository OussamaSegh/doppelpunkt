import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { Exercise as ExerciseSchema } from '@doppelpunkt/content-schema';
import { describe, expect, it } from 'vitest';
import { createProvider, explain, generatePractice, gradeWriting, tutorSystemPrompt, type OpenWriting } from '../src';
import { fakeFetch, json } from './helpers';

const unit = {
  id: 'a1-u01', level: 'A1', number: 1, title: 'Hallo!', titleEn: 'Hello!', goal: 'By the end you can greet people and introduce yourself.',
  canDo: ['greet people'], intro: { scene: 's', dialogue: [{ speaker: 'A', text: 'Hallo', en: 'Hello', variety: 'de' }] },
  grammar: [{ id: 'sein-present', title: 'sein in the present', body: '...', tables: [], commonMistakes: [] }],
  swiss: { scene: 's', dialogue: [{ speaker: 'A', text: 'Grüezi', en: 'Hello', variety: 'gsw-zh' }], notes: ['n'] },
  vocab: [{ id: 'hallo', de: 'hallo', en: 'hello', pos: 'other', tags: [] }, { id: 'name', de: 'der Name', en: 'name', pos: 'noun', gender: 'm', tags: [] }],
  exercises: [],
} as unknown as CompiledUnit;

const oa = (content: string) => json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

describe('tutorSystemPrompt', () => {
  it('lena: German only, ~5% new words, Korrekturen block, unit context', () => {
    const p = tutorSystemPrompt('lena', { level: 'A1', unit });
    expect(p).toMatch(/Korrekturen/);
    expect(p).toMatch(/5%/);
    expect(p).toMatch(/English help only when the learner explicitly asks/);
    expect(p).toContain('"Hallo!"');
    expect(p).toContain('greet people and introduce yourself');
    expect(p).toContain('hallo, der Name');
    expect(p).toContain('sein in the present');
  });
  it('keller: rubric with the four criteria for the level', () => {
    const p = tutorSystemPrompt('keller', { level: 'B1' });
    for (const k of ['task', 'coherence', 'vocabulary', 'grammar']) expect(p).toContain(`- ${k}:`);
    expect(p).toMatch(/0–5/);
    expect(p).toMatch(/weil\/dass/);
  });
  it('reto: Zurich by default, Bernese on request, labels, Hochdeutsch, (unsicher)', () => {
    const zh = tutorSystemPrompt('reto', { level: 'A2' });
    expect(zh).toContain('[Züritüütsch]');
    expect(zh).toContain('[Hochdeutsch]');
    expect(zh).toContain('(unsicher)');
    expect(zh).toMatch(/Dieth/);
    const be = tutorSystemPrompt('reto', { level: 'A2', dialect: 'gsw-be' });
    expect(be).toContain('[Bärndütsch]');
    expect(be).not.toContain('[Züritüütsch]');
  });
  it('explainer: plain English at level', () => {
    expect(tutorSystemPrompt('explainer', { level: 'A2' })).toMatch(/plain, friendly English/);
  });
});

describe('gradeWriting', () => {
  const ex = {
    id: 'w1', type: 'write', skill: 'writing', variety: 'de', prompt: 'Write', explanation: 'x', grammar: [],
    task: 'Stell dich vor.', minWords: 20, model: 'Ich heiße Anna.', checklist: ['name', 'city'],
  } as OpenWriting;
  it('returns validated feedback with clamped scores', async () => {
    const f = fakeFetch(oa(JSON.stringify({
      corrected: 'Ich heiße Tom.', errors: [{ type: 'verb', original: 'Ich heißen', correction: 'Ich heiße', explanation: 'ich takes -e' }],
      scores: { task: 4, coherence: 3.4, vocabulary: 5, grammar: 2 }, focusNext: 'Verb endings',
    })));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const fb = await gradeWriting(p, ex, 'Ich heißen Tom.', 'A1');
    expect(fb.scores).toEqual({ task: 4, coherence: 3, vocabulary: 5, grammar: 2 });
    expect(fb.errors[0]!.correction).toBe('Ich heiße');
    const sent = JSON.stringify(f.calls[0]!.json.messages);
    expect(sent).toContain('Frau Keller');
    expect(sent).toContain('Ich heißen Tom.');
    expect(sent).toContain('Stell dich vor.');
  });
});

describe('explain', () => {
  it('sends the exercise, solution, explanation and answer', async () => {
    const ex = { id: 'm1', type: 'mcq', skill: 'grammar', variety: 'de', prompt: 'Choose', explanation: 'ich bin', grammar: [], options: ['bist', 'bin'], answer: 1 } as Exercise;
    const f = fakeFetch(json({ content: [{ type: 'text', text: '  With ich, sein becomes bin.  ' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    const p = createProvider({ id: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' }, f);
    expect(await explain(p, ex, 'bist', 'A1')).toBe('With ich, sein becomes bin.');
    const body = f.calls[0]!.json;
    expect(body.system).toMatch(/plain, friendly English/);
    expect(body.messages[0].content).toContain('Correct answer: bin');
    expect(body.messages[0].content).toContain("Learner's answer: bist");
  });
});

describe('generatePractice', () => {
  const gp = { id: 'sein-present', title: 'sein in the present', body: 'ich bin, du bist', tables: [], commonMistakes: ['ich bist'] };
  const items = [
    { type: 'mcq', skill: 'grammar', prompt: 'Choose', question: 'Ich ___ müde.', options: ['bin', 'bist', 'ist'], answer: 0, explanation: 'ich bin' },
    { type: 'gap', skill: 'grammar', prompt: 'Fill', text: 'Du ___ nett.', answers: [['bist']], explanation: 'du bist' },
    { type: 'order', skill: 'grammar', prompt: 'Order', tokens: ['bin', 'Ich', 'hier'], answers: ['Ich bin hier.'], explanation: 'V2' },
    { type: 'translate', skill: 'grammar', prompt: 'Translate', source: 'We are here.', answers: ['Wir sind hier.'], explanation: 'wir sind' },
  ];
  it('returns schema-valid exercises with ai- ids and grammar tag', async () => {
    const f = fakeFetch(oa(JSON.stringify({ items })));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const out = await generatePractice(p, gp, 'A1', 4);
    expect(out).toHaveLength(4);
    for (const ex of out) {
      expect(ex.id).toMatch(/^ai-sein-present-/);
      expect(ex.grammar).toContain('sein-present');
      expect(ex.variety).toBe('de');
      expect(() => ExerciseSchema.parse(ex)).not.toThrow();
    }
    expect(new Set(out.map((e) => e.id)).size).toBe(4);
    expect(JSON.stringify(f.calls[0]!.json.messages)).toContain('ich bist');
  });
  it('retries when the gap count does not match the answers', async () => {
    const bad = [{ ...items[1], text: 'Du ___ ___.', answers: [['bist']] }];
    const f = fakeFetch(oa(JSON.stringify({ items: bad })), oa(JSON.stringify({ items: [items[1]] })));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const out = await generatePractice(p, 'Konjugation von sein', 'A1', 1);
    expect(out[0]!.id).toMatch(/^ai-konjugation-von-sein-/);
    expect(f.calls[1]!.json.messages.at(-1).content).toMatch(/gaps/);
  });
});
