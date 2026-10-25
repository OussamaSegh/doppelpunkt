import { badResponse, buildUrl, parseSse, readJson, send, splitSystem, type FetchLike } from '../http';
import { runStructured } from '../structured';
import { AiError, type ChatMessage, type ChatOptions, type Provider, type ProviderConfig, type StreamOptions, type Usage } from '../types';

const DEFAULT_MAX_TOKENS = 1024;

export function createAnthropic(cfg: ProviderConfig, fetchImpl: FetchLike): Provider {
  const url = buildUrl(cfg, 'v1/messages');
  const headers = {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = (msgs: ChatMessage[], opts: ChatOptions, stream: boolean) => {
    const { system, turns } = splitSystem(msgs);
    const b: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: turns,
    };
    if (system) b.system = system;
    if (opts.temperature !== undefined) b.temperature = opts.temperature;
    if (stream) b.stream = true;
    return JSON.stringify(b);
  };

  async function chat(msgs: ChatMessage[], opts: ChatOptions = {}) {
    const res = await send('anthropic', fetchImpl, url, { method: 'POST', headers, body: body(msgs, opts, false), signal: opts.signal }, !!cfg.relayUrl);
    const j = (await readJson('anthropic', res)) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    if (!Array.isArray(j.content)) throw badResponse('anthropic', 'no content');
    const text = j.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return { text, usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 } };
  }

  async function* stream(msgs: ChatMessage[], opts: StreamOptions = {}): AsyncGenerator<string> {
    const res = await send('anthropic', fetchImpl, url, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: body(msgs, opts, true), signal: opts.signal }, !!cfg.relayUrl);
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const ev of parseSse(res.body)) {
      let d: {
        type?: string;
        delta?: { type?: string; text?: string };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { type?: string; message?: string };
      };
      try { d = JSON.parse(ev.data); } catch { continue; }
      const type = d.type ?? ev.event;
      if (type === 'content_block_delta' && d.delta?.type === 'text_delta' && d.delta.text) yield d.delta.text;
      else if (type === 'message_start') {
        usage.inputTokens = d.message?.usage?.input_tokens ?? 0;
        usage.outputTokens = d.message?.usage?.output_tokens ?? 0;
      } else if (type === 'message_delta' && d.usage?.output_tokens !== undefined) usage.outputTokens = d.usage.output_tokens;
      else if (type === 'error') {
        const overloaded = d.error?.type === 'overloaded_error' || d.error?.type === 'rate_limit_error';
        throw new AiError(overloaded ? 'rate_limit' : 'bad_response',
          overloaded ? 'Anthropic (Claude) is overloaded right now. Wait a moment and try again.' : 'Anthropic (Claude) stopped the answer with an error. Try again.',
          { provider: 'anthropic', detail: d.error?.message });
      } else if (type === 'message_stop') break;
    }
    opts.onUsage?.(usage);
  }

  return {
    id: 'anthropic',
    model: cfg.model,
    chat,
    stream,
    // Anthropic has no simple JSON mode; the schema is described in the prompt.
    structured: (msgs, schema, opts) => runStructured('anthropic', (m, o) => chat(m, o), msgs, schema, opts),
  };
}
