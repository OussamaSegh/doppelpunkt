import type { ProviderId, Usage } from './types';

/**
 * Approximate list prices in USD per 1M tokens [input, output]. Prices are APPROXIMATE and change
 * often — this table is only for the "about $0.002" hint in the UI. Edit freely. Keys are matched
 * as model-id prefixes, longest first.
 */
export const PRICES: Record<ProviderId, Record<string, [number, number]>> = {
  anthropic: {
    'claude-opus': [5, 25],
    'claude-sonnet': [3, 15],
    'claude-haiku': [1, 5],
  },
  openai: {
    'gpt-5-nano': [0.05, 0.4],
    'gpt-5-mini': [0.25, 2],
    'gpt-5': [1.25, 10],
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4o': [2.5, 10],
  },
  gemini: {
    'gemini-2.5-flash-lite': [0.1, 0.4],
    'gemini-2.5-flash': [0.3, 2.5],
    'gemini-2.5-pro': [1.25, 10],
  },
  xai: {
    'grok-3-mini': [0.3, 0.5],
    'grok-4': [3, 15],
    'grok-3': [3, 15],
  },
};

/** Fallback per provider when the model is not in the table. */
const FALLBACK: Record<ProviderId, [number, number]> = {
  anthropic: [3, 15], openai: [1.25, 10], gemini: [0.3, 2.5], xai: [3, 15],
};

/** Approximate cost in USD for one call. */
export function estimateCost(provider: ProviderId, model: string, usage: Usage): number {
  const table = PRICES[provider] ?? {};
  const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k));
  const [inP, outP] = (key ? table[key] : undefined) ?? FALLBACK[provider] ?? [0, 0];
  return (usage.inputTokens * inP + usage.outputTokens * outP) / 1_000_000;
}

/**
 * Approximate speech-to-text prices in USD per minute of audio. APPROXIMATE, like PRICES: only for
 * the cost meter. OpenAI bills transcription per minute. Gemini bills audio as input tokens
 * (about 32 tokens per second, 1920 per minute) plus the transcript as output tokens (about 200 per
 * minute of speech), so its entries are (1920 × audio input price + 200 × output price) / 1M.
 * Keys are matched as model-id prefixes, longest first.
 */
export const TRANSCRIPTION_PRICES: Partial<Record<ProviderId, Record<string, number>>> = {
  openai: {
    'gpt-4o-transcribe': 0.006,
    'gpt-4o-mini-transcribe': 0.003,
    'whisper-1': 0.006,
  },
  gemini: {
    // audio input $1.00 / 1M, output $2.50 / 1M
    'gemini-2.5-flash': 0.0024,
    // audio input $0.30 / 1M, output $0.40 / 1M
    'gemini-2.5-flash-lite': 0.00066,
    // audio input $1.25 / 1M, output $10 / 1M
    'gemini-2.5-pro': 0.0044,
  },
};

/** Fallback per minute when the model is not in the table (providers without transcription cost 0). */
const TRANSCRIPTION_FALLBACK: Partial<Record<ProviderId, number>> = { openai: 0.006, gemini: 0.0024 };

/** Approximate cost in USD of transcribing `seconds` of audio with `provider` / `model`. */
export function estimateTranscriptionCost(provider: ProviderId, model: string, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const table = TRANSCRIPTION_PRICES[provider] ?? {};
  const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k));
  const perMinute = (key ? table[key] : undefined) ?? TRANSCRIPTION_FALLBACK[provider] ?? 0;
  return (perMinute * seconds) / 60;
}
