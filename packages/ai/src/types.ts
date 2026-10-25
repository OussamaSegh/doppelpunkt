import type { ZodType, ZodTypeDef } from 'zod';

/** A zod schema producing T; its input type is left open so preprocess/default schemas fit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SchemaOf<T> = ZodType<T, ZodTypeDef, any>;

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'xai';
export const PROVIDER_IDS: readonly ProviderId[] = ['anthropic', 'openai', 'gemini', 'xai'];

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ProviderConfig = {
  id: ProviderId;
  apiKey: string;
  model: string;
  /** Optional relay base URL, e.g. https://relay.example.workers.dev. Requests go to `${relayUrl}/${id}/<path>`. */
  relayUrl?: string;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type ChatOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
  /** Sampling temperature, when the model accepts one. */
  temperature?: number;
};

export type StreamOptions = ChatOptions & {
  /** Called once at the end of the stream with the token usage, when the provider reports it. */
  onUsage?: (usage: Usage) => void;
};

export type StructuredOptions = ChatOptions & {
  /** Overrides the schema description generated from the zod schema. */
  schemaDescription?: string;
};

export interface Provider {
  id: ProviderId;
  model: string;
  chat(msgs: ChatMessage[], opts?: ChatOptions): Promise<{ text: string; usage: Usage }>;
  stream(msgs: ChatMessage[], opts?: StreamOptions): AsyncIterable<string>;
  structured<T>(msgs: ChatMessage[], schema: SchemaOf<T>, opts?: StructuredOptions): Promise<{ data: T; usage: Usage }>;
  /** Speech to text. Available for openai and gemini. */
  transcribe?(audio: Blob, lang: 'de' | 'gsw', opts?: { signal?: AbortSignal }): Promise<string>;
}

export type AiErrorKind = 'auth' | 'rate_limit' | 'network' | 'bad_response' | 'cors';

/** Normalised error thrown by every adapter. `message` is safe to show to the learner. */
export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly provider?: ProviderId;
  readonly status?: number;
  /** Raw provider detail for debugging (never contains the API key). */
  readonly detail?: string;
  constructor(kind: AiErrorKind, message: string, extra: { provider?: ProviderId; status?: number; detail?: string; cause?: unknown } = {}) {
    super(message, extra.cause !== undefined ? { cause: extra.cause } : undefined);
    this.name = 'AiError';
    this.kind = kind;
    this.provider = extra.provider;
    this.status = extra.status;
    this.detail = extra.detail;
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  xai: 'xAI (Grok)',
};

/** Where the learner can create a key. */
export const PROVIDER_KEY_URLS: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  xai: 'https://console.x.ai',
};

/**
 * Suggested models per provider; the first is the default. Model names change often —
 * keep these editable and let the learner type any model id in settings.
 */
export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  openai: ['gpt-5', 'gpt-5-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  xai: ['grok-4', 'grok-3-mini'],
};
