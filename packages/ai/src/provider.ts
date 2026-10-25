import type { FetchLike } from './http';
import { createAnthropic } from './providers/anthropic';
import { createGemini } from './providers/gemini';
import { createOpenAiCompatible } from './providers/openai';
import type { Provider, ProviderConfig } from './types';

/** Creates a provider adapter. `fetchImpl` defaults to the global fetch (injectable for tests). */
export function createProvider(cfg: ProviderConfig, fetchImpl?: typeof fetch): Provider {
  // Bind so that browsers don't throw "Illegal invocation" when fetch is called detached from window.
  const f: FetchLike = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  switch (cfg.id) {
    case 'anthropic': return createAnthropic(cfg, f);
    case 'openai': case 'xai': return createOpenAiCompatible(cfg, f);
    case 'gemini': return createGemini(cfg, f);
    default: throw new Error(`Unknown AI provider: ${String((cfg as { id: unknown }).id)}`);
  }
}
