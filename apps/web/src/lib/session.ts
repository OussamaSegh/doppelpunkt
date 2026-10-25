// In-memory session state. Decrypted API keys live here only, never in storage.
import { create } from 'zustand';
import type { ProviderId } from '@doppelpunkt/ai';

type SessionStore = {
  /** Plaintext keys, unlocked with the learner's passphrase for this tab only. */
  keys: Partial<Record<ProviderId, string>>;
  unlock: (provider: ProviderId, apiKey: string) => void;
  lock: (provider?: ProviderId) => void;
};

export const useSession = create<SessionStore>((set) => ({
  keys: {},
  unlock: (provider, apiKey) => set((s) => ({ keys: { ...s.keys, [provider]: apiKey } })),
  lock: (provider) =>
    set((s) => {
      if (!provider) return { keys: {} };
      const keys = { ...s.keys };
      delete keys[provider];
      return { keys };
    }),
}));
