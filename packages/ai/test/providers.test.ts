import { describe, expect, it } from 'vitest';
import { createProvider, DEFAULT_MODELS, type ChatMessage } from '../src';
import { collect, fakeFetch, json, sse } from './helpers';

const msgs: ChatMessage[] = [
  { role: 'system', content: 'Be Lena.' },
  { role: 'user', content: 'Hallo!' },
  { role: 'assistant', content: 'Hallo! Wie geht es dir?' },
  { role: 'user', content: 'Gut.' },
];

describe('anthropic', () => {
  it('sends the Messages API request shape', async () => {
    const f = fakeFetch(json({ content: [{ type: 'text', text: 'Super!' }], usage: { input_tokens: 12, output_tokens: 3 } }));
    const p = createProvider({ id: 'anthropic', apiKey: 'sk-ant', model: 'claude-sonnet-5-5' }, f);
    const r = await p.chat(msgs, { maxTokens: 300 });
    expect(r).toEqual({ text: 'Super!', usage: { inputTokens: 12, outputTokens: 3 } });
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.init.method).toBe('POST');
    expect(c.headers['x-api-key']).toBe('sk-ant');
    expect(c.headers['anthropic-version']).toBe('2023-06-01');
    expect(c.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(c.headers['authorization']).toBeUndefined();
    expect(c.json).toEqual({
      model: 'claude-sonnet-5-5',
      max_tokens: 300,
      system: 'Be Lena.',
      messages: [
        { role: 'user', content: 'Hallo!' },
        { role: 'assistant', content: 'Hallo! Wie geht es dir?' },
        { role: 'user', content: 'Gut.' },
      ],
    });
  });

  it('parses the SSE stream, including events split across chunks', async () => {
    const f = fakeFetch(sse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hal"}}\r\n\r\nevent: content_block_delta\ndata: {"type":"content_bl',
      'ock_delta","index":0,"delta":{"type":"text_delta","text":"lo!"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const p = createProvider({ id: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5' }, f);
    let usage;
    const parts = await collect(p.stream(msgs, { onUsage: (u) => { usage = u; } }));
    expect(parts).toEqual(['Hal', 'lo!']);
    expect(usage).toEqual({ inputTokens: 20, outputTokens: 7 });
    expect(f.calls[0]!.json.stream).toBe(true);
  });

  it('maps a mid-stream overloaded error', async () => {
    const f = fakeFetch(sse(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']));
    const p = createProvider({ id: 'anthropic', apiKey: 'k', model: 'm' }, f);
    await expect(collect(p.stream(msgs))).rejects.toMatchObject({ name: 'AiError', kind: 'rate_limit' });
  });

  it('has no transcribe', () => {
    expect(createProvider({ id: 'anthropic', apiKey: 'k', model: 'm' }, fakeFetch()).transcribe).toBeUndefined();
  });
});

describe('openai', () => {
  it('sends the Chat Completions request shape', async () => {
    const f = fakeFetch(json({ choices: [{ message: { content: 'Gut!' } }], usage: { prompt_tokens: 9, completion_tokens: 2 } }));
    const p = createProvider({ id: 'openai', apiKey: 'sk-oa', model: 'gpt-5-mini' }, f);
    const r = await p.chat(msgs);
    expect(r.text).toBe('Gut!');
    expect(r.usage).toEqual({ inputTokens: 9, outputTokens: 2 });
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.headers['authorization']).toBe('Bearer sk-oa');
    expect(c.json.model).toBe('gpt-5-mini');
    expect(c.json.messages).toEqual(msgs);
    expect(c.json.max_completion_tokens).toBe(1024);
    expect(c.json.stream).toBeUndefined();
  });

  it('parses SSE deltas until [DONE] and reports usage', async () => {
    const f = fakeFetch(sse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Grü"}}]}\n\ndata: {"choices":[{"delta":{"content":"ezi"}}]}\n\n',
      ': keep-alive\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    let usage;
    expect(await collect(p.stream(msgs, { onUsage: (u) => { usage = u; } }))).toEqual(['Grü', 'ezi']);
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(f.calls[0]!.json).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('transcribes Swiss German with language de and a dialect prompt', async () => {
    const f = fakeFetch(json({ text: ' Grüezi mitenand ' }));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    const text = await p.transcribe!(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'gsw');
    expect(text).toBe('Grüezi mitenand');
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(c.headers['authorization']).toBe('Bearer k');
    expect(c.headers['content-type']).toBeUndefined(); // set by FormData boundary
    const form = c.init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBe('de');
    expect(String(form.get('prompt'))).toMatch(/Schweizerdeutsch/);
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('falls back to whisper-1 when the first model is unavailable', async () => {
    const f = fakeFetch(json({ error: { message: 'model not found' } }, 404), json({ text: 'Hallo' }));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    expect(await p.transcribe!(new Blob(['x'], { type: 'audio/mp4' }), 'de')).toBe('Hallo');
    expect((f.calls[1]!.init.body as FormData).get('model')).toBe('whisper-1');
    expect((f.calls[0]!.init.body as FormData).get('prompt')).toBeNull();
  });

  it('does not fall back on auth errors', async () => {
    const f = fakeFetch(json({ error: { message: 'Incorrect API key' } }, 401));
    const p = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5' }, f);
    await expect(p.transcribe!(new Blob(['x']), 'de')).rejects.toMatchObject({ kind: 'auth' });
    expect(f.calls).toHaveLength(1);
  });
});

describe('xai', () => {
  it('uses the OpenAI-compatible endpoint at api.x.ai', async () => {
    const f = fakeFetch(json({ choices: [{ message: { content: 'Ja.' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const p = createProvider({ id: 'xai', apiKey: 'xai-k', model: 'grok-4' }, f);
    expect((await p.chat(msgs, { maxTokens: 50 })).text).toBe('Ja.');
    const c = f.calls[0]!;
    expect(c.url).toBe('https://api.x.ai/v1/chat/completions');
    expect(c.headers['authorization']).toBe('Bearer xai-k');
    expect(c.json.max_tokens).toBe(50);
    expect(p.id).toBe('xai');
    expect(p.transcribe).toBeUndefined();
  });
});

describe('gemini', () => {
  it('sends generateContent with systemInstruction and user/model roles', async () => {
    const f = fakeFetch(json({
      candidates: [{ content: { parts: [{ text: 'Sehr ' }, { text: 'gut!' }] } }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4, thoughtsTokenCount: 10 },
    }));
    const p = createProvider({ id: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' }, f);
    const r = await p.chat(msgs, { maxTokens: 500 });
    expect(r).toEqual({ text: 'Sehr gut!', usage: { inputTokens: 30, outputTokens: 14 } });
    const c = f.calls[0]!;
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('AIza');
    expect(c.url).not.toContain('key=');
    expect(c.json).toEqual({
      systemInstruction: { parts: [{ text: 'Be Lena.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hallo!' }] },
        { role: 'model', parts: [{ text: 'Hallo! Wie geht es dir?' }] },
        { role: 'user', parts: [{ text: 'Gut.' }] },
      ],
      generationConfig: { maxOutputTokens: 500 },
    });
  });

  it('streams via streamGenerateContent?alt=sse', async () => {
    const f = fakeFetch(sse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hal"}],"role":"model"}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\r\n\r\n',
    ]));
    const p = createProvider({ id: 'gemini', apiKey: 'k', model: 'gemini-2.5-pro' }, f);
    let usage;
    expect(await collect(p.stream(msgs, { onUsage: (u) => { usage = u; } }))).toEqual(['Hal', 'lo']);
    expect(usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
  });

  it('transcribes by sending inline audio with an instruction', async () => {
    const f = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'Ich bi de Reto.\n' }] } }] }));
    const p = createProvider({ id: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash' }, f);
    const t = await p.transcribe!(new Blob([new Uint8Array([104, 105])], { type: 'audio/ogg' }), 'gsw');
    expect(t).toBe('Ich bi de Reto.');
    const parts = f.calls[0]!.json.contents[0].parts;
    expect(parts[0].text).toMatch(/Swiss German/);
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'audio/ogg', data: 'aGk=' } });
  });

  it('flags safety blocks as bad_response', async () => {
    const f = fakeFetch(json({ promptFeedback: { blockReason: 'SAFETY' } }));
    const p = createProvider({ id: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash' }, f);
    await expect(p.chat(msgs)).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('relay', () => {
  const ok = () => json({ content: [{ type: 'text', text: '' }], choices: [{ message: { content: '' } }], candidates: [{ content: { parts: [] } }] });
  it.each([
    ['anthropic', 'https://relay.example.dev/anthropic/v1/messages'],
    ['openai', 'https://relay.example.dev/openai/v1/chat/completions'],
    ['xai', 'https://relay.example.dev/xai/v1/chat/completions'],
    ['gemini', 'https://relay.example.dev/gemini/v1beta/models/m:generateContent'],
  ] as const)('rewrites %s to the relay with the same headers', async (id, url) => {
    const f = fakeFetch(ok());
    const p = createProvider({ id, apiKey: 'KEY', model: 'm', relayUrl: 'https://relay.example.dev/' }, f);
    await p.chat(msgs);
    expect(f.calls[0]!.url).toBe(url);
    const h = f.calls[0]!.headers;
    expect(h['x-api-key'] ?? h['authorization'] ?? h['x-goog-api-key']).toMatch(/KEY/);
  });

  it('rewrites gemini streaming and openai transcription too', async () => {
    const f = fakeFetch(sse(['data: [DONE]\n\n']), json({ text: 'x' }));
    const g = createProvider({ id: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash', relayUrl: 'https://r.dev' }, f);
    await collect(g.stream(msgs));
    const o = createProvider({ id: 'openai', apiKey: 'k', model: 'gpt-5', relayUrl: 'https://r.dev' }, f);
    await o.transcribe!(new Blob(['x']), 'de');
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://r.dev/gemini/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      'https://r.dev/openai/v1/audio/transcriptions',
    ]);
  });
});

describe('DEFAULT_MODELS', () => {
  it('lists models for every provider', () => {
    expect(DEFAULT_MODELS.anthropic).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
    for (const list of Object.values(DEFAULT_MODELS)) expect(list.length).toBeGreaterThan(0);
  });
});
