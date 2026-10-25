import { badResponse, blobToBase64, buildUrl, parseSse, readJson, send, splitSystem, type FetchLike } from '../http';
import { runStructured } from '../structured';
import { AiError, type ChatMessage, type ChatOptions, type Provider, type ProviderConfig, type StreamOptions, type Usage } from '../types';

// Gemini 2.5 models spend part of the output budget on thinking, so the default is a bit higher.
const DEFAULT_MAX_TOKENS = 2048;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

function textOf(r: GeminiResponse): string {
  return (r.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
}

function usageOf(r: GeminiResponse): Usage {
  const u = r.usageMetadata ?? {};
  return { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
}

export function createGemini(cfg: ProviderConfig, fetchImpl: FetchLike): Provider {
  const model = encodeURIComponent(cfg.model);
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey };
  const hasRelay = !!cfg.relayUrl;

  const body = (msgs: ChatMessage[], opts: ChatOptions & { json?: boolean }) => {
    const { system, turns } = splitSystem(msgs);
    const generationConfig: Record<string, unknown> = { maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS };
    if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
    if (opts.json) generationConfig.responseMimeType = 'application/json';
    const b: Record<string, unknown> = {
      contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
      generationConfig,
    };
    if (system) b.systemInstruction = { parts: [{ text: system }] };
    return b;
  };

  async function generate(b: Record<string, unknown>, signal?: AbortSignal) {
    const res = await send('gemini', fetchImpl, buildUrl(cfg, `v1beta/models/${model}:generateContent`), { method: 'POST', headers, body: JSON.stringify(b), signal }, hasRelay);
    const j = (await readJson('gemini', res)) as GeminiResponse;
    if (j.promptFeedback?.blockReason) {
      throw new AiError('bad_response', 'Google Gemini refused to answer this request (safety filter). Try rephrasing.', { provider: 'gemini', detail: j.promptFeedback.blockReason });
    }
    if (!j.candidates?.length) throw badResponse('gemini', 'no candidates');
    return { text: textOf(j), usage: usageOf(j) };
  }

  async function chat(msgs: ChatMessage[], opts: ChatOptions & { json?: boolean } = {}) {
    return generate(body(msgs, opts), opts.signal);
  }

  async function* stream(msgs: ChatMessage[], opts: StreamOptions = {}): AsyncGenerator<string> {
    const url = buildUrl(cfg, `v1beta/models/${model}:streamGenerateContent?alt=sse`);
    const res = await send('gemini', fetchImpl, url, { method: 'POST', headers: { ...headers, accept: 'text/event-stream' }, body: JSON.stringify(body(msgs, opts)), signal: opts.signal }, hasRelay);
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    for await (const ev of parseSse(res.body)) {
      let d: GeminiResponse & { error?: { message?: string } };
      try { d = JSON.parse(ev.data); } catch { continue; }
      if (d.error) throw new AiError('bad_response', 'Google Gemini stopped the answer with an error. Try again.', { provider: 'gemini', detail: d.error.message });
      const t = textOf(d);
      if (t) yield t;
      if (d.usageMetadata) usage = usageOf(d);
    }
    opts.onUsage?.(usage);
  }

  return {
    id: 'gemini',
    model: cfg.model,
    chat,
    stream,
    structured: (msgs, schema, opts) => runStructured('gemini', (m, o) => chat(m, o), msgs, schema, opts),
    async transcribe(audio, lang, opts = {}) {
      const instruction = lang === 'gsw'
        ? 'Transcribe this Swiss German (dialect) audio exactly as spoken, using Dieth-style Swiss German spelling (e.g. "Grüezi mitenand, wie gaats?"). Do not translate it into Standard German. Output only the transcript.'
        : 'Transcribe this German audio exactly as spoken. Output only the transcript, no comments.';
      const data = await blobToBase64(audio);
      const { text } = await generate({
        contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: audio.type || 'audio/webm', data } }] }],
        generationConfig: { maxOutputTokens: DEFAULT_MAX_TOKENS, temperature: 0 },
      }, opts.signal);
      return text.trim();
    },
  };
}
