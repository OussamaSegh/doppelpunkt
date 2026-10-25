import { describe, expect, it, vi } from 'vitest';
import { handle } from '../src/index';

type Seen = { url: string; init: RequestInit; headers: Headers; body?: string };

function upstream(res: () => Response) {
  const seen: Seen[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const body = init.body ? await new Response(init.body as BodyInit).text() : undefined;
    seen.push({ url: String(input), init, headers: new Headers(init.headers), body });
    return res();
  }) as typeof fetch;
  return { f, seen };
}

const post = (path: string, headers: Record<string, string> = {}, body = '{"a":1}') =>
  new Request(`https://relay.example.dev${path}`, { method: 'POST', headers, body });

describe('relay', () => {
  it.each([
    ['/anthropic/v1/messages', 'https://api.anthropic.com/v1/messages'],
    ['/openai/v1/chat/completions', 'https://api.openai.com/v1/chat/completions'],
    ['/xai/v1/chat/completions', 'https://api.x.ai/v1/chat/completions'],
    ['/gemini/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'],
  ])('forwards %s', async (path, target) => {
    const { f, seen } = upstream(() => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const res = await handle(post(path, { 'content-type': 'application/json' }), {}, f);
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe(target);
    expect(seen[0]!.init.method).toBe('POST');
    expect(seen[0]!.body).toBe('{"a":1}');
    expect(await res.text()).toBe('{"ok":true}');
  });

  it('passes only allowlisted request headers', async () => {
    const { f, seen } = upstream(() => new Response('{}'));
    await handle(post('/anthropic/v1/messages', {
      'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      cookie: 'session=1', origin: 'https://app.example', 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '1.2.3.4',
    }), {}, f);
    const h = seen[0]!.headers;
    expect(h.get('x-api-key')).toBe('sk-ant');
    expect(h.get('anthropic-version')).toBe('2023-06-01');
    expect(h.get('cookie')).toBeNull();
    expect(h.get('origin')).toBeNull();
    expect(h.get('x-forwarded-for')).toBeNull();
    expect(h.get('cf-connecting-ip')).toBeNull();
  });

  it('adds CORS headers and filters response headers', async () => {
    const { f } = upstream(() => new Response('{}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3', 'set-cookie': 'x=1', 'x-ratelimit-remaining-requests': '0' } }));
    const res = await handle(post('/openai/v1/chat/completions', { origin: 'https://app.example', authorization: 'Bearer k' }), {}, f);
    expect(res.status).toBe(429);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(res.headers.get('retry-after')).toBe('3');
    expect(res.headers.get('x-ratelimit-remaining-requests')).toBe('0');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers OPTIONS preflight without calling upstream', async () => {
    const { f, seen } = upstream(() => new Response('{}'));
    const res = await handle(new Request('https://relay.example.dev/gemini/v1beta/x', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), {}, f);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('x-goog-api-key');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(seen).toHaveLength(0);
  });

  it('enforces ALLOWED_ORIGINS', async () => {
    const { f, seen } = upstream(() => new Response('{}'));
    const env = { ALLOWED_ORIGINS: 'https://doppelpunkt.app, http://localhost:5173' };
    const denied = await handle(post('/openai/v1/chat/completions', { origin: 'https://evil.example' }), env, f);
    expect(denied.status).toBe(403);
    const ok = await handle(post('/openai/v1/chat/completions', { origin: 'http://localhost:5173' }), env, f);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(seen).toHaveLength(1);
  });

  it('streams the response body through', async () => {
    const enc = new TextEncoder();
    const { f } = upstream(() => new Response(new ReadableStream({
      start(c) { c.enqueue(enc.encode('data: 1\n\n')); c.enqueue(enc.encode('data: 2\n\n')); c.close(); },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const res = await handle(post('/anthropic/v1/messages'), {}, f);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(await res.text()).toBe('data: 1\n\ndata: 2\n\n');
  });

  it('rejects unknown providers and bad methods', async () => {
    const { f, seen } = upstream(() => new Response('{}'));
    expect((await handle(post('/evil/v1/x'), {}, f)).status).toBe(404);
    expect((await handle(new Request('https://relay.example.dev/openai/v1/x', { method: 'DELETE' }), {}, f)).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  it('returns 502 when upstream is unreachable and never logs', async () => {
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const f = (async () => { throw new TypeError('fail'); }) as typeof fetch;
    const res = await handle(post('/xai/v1/chat/completions', { authorization: 'Bearer secret' }), {}, f);
    expect(res.status).toBe(502);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
