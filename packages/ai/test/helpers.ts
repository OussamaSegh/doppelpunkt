export type Call = { url: string; init: RequestInit; headers: Record<string, string>; json?: any };

export function fakeFetch(...responses: Array<Response | (() => Response) | Error>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    let json: any;
    if (typeof init.body === 'string') { try { json = JSON.parse(init.body); } catch { /* */ } }
    calls.push({ url: String(input), init, headers, json });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no response queued');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An SSE response whose body arrives in the given raw chunks (to test split events). */
export function sse(chunks: string[]) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

export async function collect(it: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const s of it) out.push(s);
  return out;
}
