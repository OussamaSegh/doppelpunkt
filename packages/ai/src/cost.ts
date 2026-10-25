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
