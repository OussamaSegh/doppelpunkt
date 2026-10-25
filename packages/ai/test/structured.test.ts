import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiError, createProvider, describeSchema, extractJson } from '../src';
import { fakeFetch, json } from './helpers';

const Schema = z.object({ word: z.string(), gender: z.enum(['m', 'f', 'n']), examples: z.array(z.string()).optional() });
const oa = (content: string) => json({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
const an = (text: string) => json({ content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });
const ge = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });

describe('extractJson', () => {
  it('strips code fences and prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":[1,2]} hope it helps')).toEqual({ a: [1, 2] });
    expect(extractJson('[1,2]')).toEqual([1, 2]);
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('describeSchema', () => {
  it('describes objects, enums, arrays and optionals', () => {
    const d = describeSchema(Schema);
    expect(d).toContain('"word": string');
    expect(d).toContain('"gender": "m" | "f" | "n"');
    expect(d).toContain('"examples"?: string[]');
  });
});

describe('structured', () => {
  it('openai: uses json_object mode and validates', async () => {
    const f = fakeFetch(oa('{"word":"Tisch","gender":"m"}'));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const r = await p.structured([{ role: 'user', content: 'Gender of Tisch?' }], Schema);
    expect(r.data).toEqual({ word: 'Tisch', gender: 'm' });
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const body = f.calls[0]!.json;
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(body.messages)).toMatch(/JSON/);
    expect(JSON.stringify(body.messages)).toContain('\\"gender\\"');
  });

  it('gemini: sets responseMimeType application/json', async () => {
    const f = fakeFetch(ge('{"word":"Lampe","gender":"f"}'));
    const p = createProvider({ id: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash' }, f);
    expect((await p.structured([{ role: 'user', content: 'x' }], Schema)).data.gender).toBe('f');
    expect(f.calls[0]!.json.generationConfig.responseMimeType).toBe('application/json');
    expect(f.calls[0]!.json.systemInstruction.parts[0].text).toMatch(/JSON/);
  });

  it('anthropic: strips fences, retries once with the validation error, sums usage', async () => {
    const f = fakeFetch(an('```json\n{"word":"Haus","gender":"x"}\n```'), an('```json\n{"word":"Haus","gender":"n"}\n```'));
    const p = createProvider({ id: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' }, f);
    const r = await p.structured([{ role: 'user', content: 'Haus?' }], Schema);
    expect(r.data).toEqual({ word: 'Haus', gender: 'n' });
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    const retry = f.calls[1]!.json;
    expect(retry.system).toMatch(/JSON/);
    const last = retry.messages.at(-1);
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/gender/);
    expect(retry.messages.at(-2)).toEqual({ role: 'assistant', content: '```json\n{"word":"Haus","gender":"x"}\n```' });
  });

  it('retries after unparseable JSON', async () => {
    const f = fakeFetch(oa('sorry, I cannot'), oa('{"word":"Tür","gender":"f"}'));
    const p = createProvider({ id: 'xai', apiKey: 'k', model: 'grok-4' }, f);
    expect((await p.structured([{ role: 'user', content: 'x' }], Schema)).data.word).toBe('Tür');
  });

  it('throws a bad_response AiError after the second failure', async () => {
    const f = fakeFetch(oa('{"word":1}'), oa('{"word":2}'));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const e = await p.structured([{ role: 'user', content: 'x' }], Schema).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.kind).toBe('bad_response');
    expect(f.calls).toHaveLength(2);
  });
});
