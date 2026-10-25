import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, createProvider, estimateCost, type ProviderId } from '../src';
import { fakeFetch, json } from './helpers';

const msgs = [{ role: 'user' as const, content: 'Hallo' }];
const ids: ProviderId[] = ['anthropic', 'openai', 'gemini', 'xai'];

describe('error mapping', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(ids)('%s: 401 -> auth, 429 -> rate_limit, 500 -> network, 400 -> bad_response', async (id) => {
    const f = fakeFetch(
      json({ error: { message: 'invalid x-api-key' } }, 401),
      json({ error: { message: 'slow down' } }, 429),
      json({ error: { message: 'boom' } }, 500),
      json({ error: { message: 'max_tokens too large' } }, 400),
    );
    const p = createProvider({ id, apiKey: 'secret-key', model: 'm' }, f);
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      try { await p.chat(msgs); } catch (e) {
        expect(e).toBeInstanceOf(AiError);
        expect((e as AiError).message).not.toContain('secret-key');
        expect((e as AiError).provider).toBe(id);
        kinds.push((e as AiError).kind);
      }
    }
    expect(kinds).toEqual(['auth', 'rate_limit', 'network', 'bad_response']);
  });

  it('maps Gemini 400 API_KEY_INVALID to auth', async () => {
    const f = fakeFetch(json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400));
    const p = createProvider({ id: 'gemini', apiKey: 'k', model: 'm' }, f);
    await expect(p.chat(msgs)).rejects.toMatchObject({ kind: 'auth', status: 400 });
  });

  it('maps Anthropic 529 overloaded to rate_limit', async () => {
    const f = fakeFetch(json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529));
    await expect(createProvider({ id: 'anthropic', apiKey: 'k', model: 'm' }, f).chat(msgs)).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('maps a fetch TypeError outside the browser to network', async () => {
    const f = fakeFetch(new TypeError('fetch failed'));
    await expect(createProvider({ id: 'openai', apiKey: 'k', model: 'm' }, f).chat(msgs)).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps a fetch TypeError in an online browser to cors', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { onLine: true });
    const f = fakeFetch(new TypeError('Failed to fetch'));
    const e = await createProvider({ id: 'xai', apiKey: 'k', model: 'm' }, f).chat(msgs).catch((x) => x);
    expect(e).toMatchObject({ kind: 'cors' });
    expect(e.message).toMatch(/relay/);
  });

  it('maps a fetch failure while offline to network', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { onLine: false });
    const f = fakeFetch(new TypeError('Failed to fetch'));
    await expect(createProvider({ id: 'gemini', apiKey: 'k', model: 'm' }, f).chat(msgs)).rejects.toMatchObject({ kind: 'network', message: expect.stringMatching(/offline/) });
  });

  it('rethrows AbortError unchanged', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const f = fakeFetch(abort);
    await expect(createProvider({ id: 'anthropic', apiKey: 'k', model: 'm' }, f).chat(msgs)).rejects.toBe(abort);
  });

  it('maps non-JSON 200 bodies to bad_response', async () => {
    const f = fakeFetch(new Response('<html>oops</html>', { status: 200 }));
    await expect(createProvider({ id: 'openai', apiKey: 'k', model: 'm' }, f).chat(msgs)).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('estimateCost', () => {
  it('uses the longest matching prefix', () => {
    expect(estimateCost('openai', 'gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.25);
    expect(estimateCost('openai', 'gpt-5', { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(10);
    expect(estimateCost('anthropic', 'claude-sonnet-5-5', { inputTokens: 1000, outputTokens: 1000 })).toBeCloseTo(0.018);
  });
  it('falls back for unknown models', () => {
    expect(estimateCost('gemini', 'gemini-9-ultra', { inputTokens: 1_000_000, outputTokens: 0 })).toBeGreaterThan(0);
  });
});
