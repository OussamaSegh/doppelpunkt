// Glue between settings, the in-memory key store and @doppelpunkt/ai: picks the active provider,
// enforces the monthly spend cap and records token usage for the cost meter.
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  createProvider,
  DEFAULT_MODELS,
  PROVIDER_IDS,
  estimateCost,
  type ChatMessage,
  type Provider,
  type ProviderId,
  type Usage,
} from '@doppelpunkt/ai';
import { db, type Settings, type UsageRow } from '../db';
import { useSession } from './session';
import { useSettings } from './hooks';

export const PROVIDERS: readonly ProviderId[] = PROVIDER_IDS;

export class SpendCapError extends Error {
  constructor(cap: number) {
    super(`Monthly AI spend cap of $${cap.toFixed(2)} reached. Raise it in Settings to continue.`);
    this.name = 'SpendCapError';
  }
}

export function modelFor(settings: Settings, id: ProviderId): string {
  return settings.models[id] ?? DEFAULT_MODELS[id]?.[0] ?? '';
}

function monthStart(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export async function monthSpend(): Promise<number> {
  const rows = await db.usage.where('at').aboveOrEqual(monthStart()).toArray();
  return rows.reduce((sum, r) => sum + r.costUsd, 0);
}

export async function recordUsage(
  provider: ProviderId,
  model: string,
  usage: Usage,
  purpose: UsageRow['purpose'],
  estimated = false,
): Promise<number> {
  const costUsd = estimateCost(provider, model, usage);
  await db.usage.add({
    at: new Date().toISOString(),
    provider,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    purpose,
    estimated,
  });
  return costUsd;
}

/** Rough token estimate (~4 characters per token) for streams that report no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Wraps a provider so every call checks the cap first and logs its usage afterwards. */
export function trackedProvider(p: Provider, cap: number, purpose: UsageRow['purpose']): Provider {
  const guard = async () => {
    if (cap <= 0 || (await monthSpend()) >= cap) throw new SpendCapError(cap);
  };
  const log = (u: Usage, estimated = false) => recordUsage(p.id, p.model, u, purpose, estimated);

  const chat: Provider['chat'] = async (msgs, opts) => {
    await guard();
    const r = await p.chat(msgs, opts);
    await log(r.usage);
    return r;
  };
  const structured: Provider['structured'] = async (msgs, schema, opts) => {
    await guard();
    const r = await p.structured(msgs, schema, opts);
    await log(r.usage);
    return r;
  };
  const stream: Provider['stream'] = (msgs, opts) => ({
    async *[Symbol.asyncIterator]() {
      await guard();
      let reported = false;
      let out = '';
      for await (const chunk of p.stream(msgs, {
        ...opts,
        onUsage: (u) => {
          reported = true;
          opts?.onUsage?.(u);
          void log(u);
        },
      })) {
        out += chunk;
        yield chunk;
      }
      if (!reported) {
        const u = { inputTokens: estimateTokens(msgs.map((m: ChatMessage) => m.content).join('\n')), outputTokens: estimateTokens(out) };
        opts?.onUsage?.(u);
        await log(u, true);
      }
    },
  });
  return { ...p, chat, structured, stream, transcribe: p.transcribe?.bind(p) };
}

export type AiAvailability =
  | { status: 'ready'; provider: Provider; providerId: ProviderId; model: string }
  | { status: 'no-key' | 'locked' | 'cap-zero' | 'loading'; providerId?: ProviderId };

/**
 * The provider the learner chose, if its key is unlocked in this tab.
 * `preferred` lets a screen (e.g. the tutor) pick another unlocked provider.
 */
export function useAi(purpose: UsageRow['purpose'], preferred?: ProviderId): AiAvailability {
  const settings = useSettings();
  const keys = useSession((s) => s.keys);
  const saved = useLiveQuery(() => db.aiKeys.toArray(), []);

  const providerId: ProviderId | undefined = settings
    ? (preferred ?? settings.activeProvider ?? PROVIDERS.find((p) => keys[p]) ?? saved?.[0]?.provider)
    : undefined;
  const apiKey = providerId ? keys[providerId] : undefined;
  const model = settings && providerId ? modelFor(settings, providerId) : '';
  const relayUrl = settings?.relayUrl || undefined;
  const cap = settings?.monthlyCapUsd ?? 0;

  const provider = useMemo(
    () =>
      providerId && apiKey && cap > 0
        ? trackedProvider(createProvider({ id: providerId, apiKey, model, relayUrl }), cap, purpose)
        : undefined,
    [providerId, apiKey, model, relayUrl, cap, purpose],
  );

  if (!settings || !saved) return { status: 'loading' };
  if (!providerId) return { status: 'no-key' };
  if (!apiKey) return { status: saved.some((k) => k.provider === providerId) ? 'locked' : 'no-key', providerId };
  if (!provider) return { status: 'cap-zero', providerId };
  return { status: 'ready', provider, providerId, model };
}

export function aiUnavailableMessage(a: AiAvailability): string {
  switch (a.status) {
    case 'no-key':
      return 'Add an AI key in Settings to get AI feedback.';
    case 'locked':
      return 'Unlock your AI key in Settings (passphrase) to get AI feedback.';
    case 'cap-zero':
      return 'AI is switched off: the monthly spend cap is $0.';
    case 'loading':
      return 'Loading…';
    default:
      return '';
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
