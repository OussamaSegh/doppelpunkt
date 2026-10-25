import { badResponse, buildUrl, parseSse, readJson, send, type FetchLike } from '../http';
import { runStructured } from '../structured';
import { AiError, type ChatMessage, type ChatOptions, type Provider, type ProviderConfig, type StreamOptions, type Usage } from '../types';

const DEFAULT_MAX_TOKENS = 1024;
/** Transcription models, tried in order. Names change; adjust here. */
export const OPENAI_TRANSCRIBE_MODELS = ['gpt-4o-transcribe', 'whisper-1'];
export const SWISS_GERMAN_TRANSCRIBE_PROMPT =
  'Das Audio ist Schweizerdeutsch (Mundart, z. B. Züritüütsch oder Bärndütsch). Schreibe, was gesagt wird, in Dieth-Schreibung, z. B. «Grüezi mitenand, wie gaats?»';

/** OpenAI Chat Completions adapter. Also used for xAI, which exposes the same API. */
export function createOpenAiCompatible(cfg: ProviderConfig, fetchImpl: FetchLike): Provider {
  const pid = cfg.id; // 'openai' | 'xai'
  const url = buildUrl(cfg, 'v1/chat/completions');
  const auth = { authorization: `Bearer ${cfg.apiKey}` };
  const headers = { ...auth, 'content-type': 'application/json' };
  const hasRelay = !!cfg.relayUrl;

  const body = (msgs: ChatMessage[], opts: ChatOptions & { json?: boolean }, stream: boolean) => {
    const b: Record<string, unknown> = {
      model: cfg.model,
      messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    };
    const max = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    // OpenAI's newer models only accept max_completion_tokens; xAI accepts max_tokens.
    if (pid === 'openai') b.max_completion_tokens = max;
    else b.max_tokens = max;
    if (opts.temperature !== undefined) b.temperature = opts.temperature;
    if (opts.json) b.response_format = { type: 'json_object' };
    if (stream) {
      b.stream = true;
      b.stream_options = { include_usage: true };
    }
    return JSON.stringify(b);
  };

  async function chat(msgs: ChatMessage[], opts: ChatOptions & { json?: boolean } = {}) {
    const res = await send(pid, fetchImpl, url, { method: 'POST', headers, body: body(msgs, opts, false), signal: opts.signal }, hasRelay);
    const j = (await readJson(pid, res)) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = j.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw badResponse(pid, 'no message content');
    return { text, usage: { inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 } };
  }

  async function* stream(msgs: ChatMessage[], opts: StreamOptions = {}): AsyncGenerator<string> {
    const res = await send(pid, fetchImpl, url, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: body(msgs, opts, true), signal: opts.signal }, hasRelay);
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const ev of parseSse(res.body)) {
      if (ev.data === '[DONE]') break;
      let d: {
        choices?: { delta?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        error?: { message?: string };
      };
      try { d = JSON.parse(ev.data); } catch { continue; }
      if (d.error) throw new AiError('bad_response', 'The provider stopped the answer with an error. Try again.', { provider: pid, detail: d.error.message });
      const c = d.choices?.[0]?.delta?.content;
      if (c) yield c;
      if (d.usage) {
        usage.inputTokens = d.usage.prompt_tokens ?? 0;
        usage.outputTokens = d.usage.completion_tokens ?? 0;
      }
    }
    opts.onUsage?.(usage);
  }

  const provider: Provider = {
    id: pid,
    model: cfg.model,
    chat,
    stream,
    structured: (msgs, schema, opts) => runStructured(pid, (m, o) => chat(m, o), msgs, schema, opts),
  };

  if (pid === 'openai') {
    provider.transcribe = async (audio, lang, opts = {}) => {
      const tUrl = buildUrl(cfg, 'v1/audio/transcriptions');
      let lastErr: unknown;
      for (const model of OPENAI_TRANSCRIBE_MODELS) {
        const form = new FormData();
        const name = `audio.${extFor(audio.type)}`;
        form.append('file', audio, name);
        form.append('model', model);
        form.append('language', 'de');
        if (lang === 'gsw') form.append('prompt', SWISS_GERMAN_TRANSCRIBE_PROMPT);
        form.append('response_format', 'json');
        try {
          const res = await send(pid, fetchImpl, tUrl, { method: 'POST', headers: auth, body: form, signal: opts.signal }, hasRelay);
          const j = (await readJson(pid, res)) as { text?: string };
          if (typeof j.text !== 'string') throw badResponse(pid, 'no transcript');
          return j.text.trim();
        } catch (e) {
          lastErr = e;
          // Only fall back when the model itself is unavailable (not for auth/rate/network problems).
          if (!(e instanceof AiError) || e.kind !== 'bad_response') throw e;
        }
      }
      throw lastErr;
    };
  }
  return provider;
}

export function extFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}
