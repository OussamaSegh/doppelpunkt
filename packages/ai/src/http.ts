import { AiError, PROVIDER_LABELS, type ProviderConfig, type ProviderId } from './types';

export type FetchLike = typeof fetch;

export const PROVIDER_BASES: Record<ProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  xai: 'https://api.x.ai',
};

/** Builds the request URL. `path` has no leading slash, e.g. "v1/messages". With a relay: `${relayUrl}/${id}/${path}`. */
export function buildUrl(cfg: Pick<ProviderConfig, 'id' | 'relayUrl'>, path: string): string {
  const p = path.replace(/^\/+/, '');
  if (cfg.relayUrl) return `${cfg.relayUrl.replace(/\/+$/, '')}/${cfg.id}/${p}`;
  return `${PROVIDER_BASES[cfg.id]}/${p}`;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

/** fetch wrapper: maps transport failures and non-2xx responses to AiError. AbortError is rethrown unchanged. */
export async function send(provider: ProviderId, fetchImpl: FetchLike, url: string, init: RequestInit, hasRelay: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw transportError(provider, e, hasRelay);
  }
  if (!res.ok) throw await httpError(provider, res);
  return res;
}

export function transportError(provider: ProviderId, cause: unknown, hasRelay: boolean): AiError {
  const label = PROVIDER_LABELS[provider];
  const offline = typeof navigator !== 'undefined' && (navigator as { onLine?: boolean }).onLine === false;
  const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (offline || !inBrowser || hasRelay) {
    return new AiError('network', offline
      ? 'You appear to be offline. Check your connection and try again.'
      : `Could not reach ${hasRelay ? 'the relay' : label}. Check your connection and try again.`, { provider, cause, detail: String(cause) });
  }
  // In the browser a blocked cross-origin request is indistinguishable from a network failure.
  return new AiError('cors', `Could not reach ${label} from the browser. This is usually a network problem, or the provider is blocking browser requests (CORS). Check your connection, or set up the optional relay in Settings.`, { provider, cause, detail: String(cause) });
}

export async function httpError(provider: ProviderId, res: Response): Promise<AiError> {
  const label = PROVIDER_LABELS[provider];
  let body = '';
  try { body = await res.text(); } catch { /* ignore */ }
  const detail = extractProviderMessage(body) ?? body.slice(0, 500);
  const status = res.status;
  const extra = { provider, status, detail };
  const looksLikeKey = /api[_ -]?key|unauthori[sz]ed|authentication|permission|invalid x-api-key/i.test(detail);
  if (status === 401 || status === 403 || (status === 400 && looksLikeKey)) {
    return new AiError('auth', `${label} rejected your API key. Check the key in Settings (and that it has access to this model).`, extra);
  }
  if (status === 429 || status === 529) {
    return new AiError('rate_limit', `${label} is rate limiting requests or is out of credit. Wait a moment and try again, or check your plan and billing.`, extra);
  }
  if (status >= 500) {
    return new AiError('network', `${label} is having problems right now (error ${status}). Try again in a little while.`, extra);
  }
  if (status === 404) {
    return new AiError('bad_response', `${label} did not find that model or endpoint. Check the model name in Settings.`, extra);
  }
  return new AiError('bad_response', `${label} could not handle the request (error ${status})${detail ? `: ${detail.slice(0, 200)}` : '.'}`, extra);
}

function extractProviderMessage(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as unknown;
    const arr = Array.isArray(j) ? j[0] : j; // gemini sometimes wraps in an array
    const err = (arr as { error?: unknown })?.error;
    if (typeof err === 'string') return err;
    const msg = (err as { message?: unknown })?.message;
    if (typeof msg === 'string') return msg;
  } catch { /* not JSON */ }
  return undefined;
}

export function badResponse(provider: ProviderId, what: string, detail?: string): AiError {
  return new AiError('bad_response', `${PROVIDER_LABELS[provider]} sent an unexpected response (${what}). Try again.`, { provider, detail });
}

export async function readJson(provider: ProviderId, res: Response): Promise<unknown> {
  const t = await res.text();
  try { return JSON.parse(t); } catch { throw badResponse(provider, 'invalid JSON', t.slice(0, 500)); }
}

export type SseEvent = { event?: string; data: string };

/** Parses a text/event-stream body into events. Handles \n and \r\n, multi-line data, comments. */
export async function* parseSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<SseEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | undefined;
  let data: string[] = [];
  const flushLine = function* (line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = undefined;
      data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.search(/\r\n|\n|\r/)) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf[nl] === '\r' && buf[nl + 1] === '\n' ? 2 : 1));
        yield* flushLine(line);
      }
    }
    buf += decoder.decode();
    if (buf) yield* flushLine(buf);
    yield* flushLine('');
  } finally {
    reader.releaseLock();
  }
}

/** Splits messages into a system string and the remaining turns, merging consecutive same-role turns. */
export function splitSystem(msgs: { role: 'system' | 'user' | 'assistant'; content: string }[]) {
  const system = msgs.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else turns.push({ role: m.role, content: m.content });
  }
  return { system, turns };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytesToBase64(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
