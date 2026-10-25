// Starts the beta programme's background work. Kept tiny because it is part of the initial
// bundle: the actual reporting and sending code loads on demand.
import { collectorUrl } from './config';

const SYNC_EVERY_MS = 15 * 60_000;

/** Global error handlers (only reported when the learner opted in to crash reports). */
export function installCrashHandlers(): void {
  const report = (error: unknown) => {
    void import('./crash').then((m) => m.reportCrash(error)).catch(() => undefined);
  };
  window.addEventListener('error', (e) => {
    // Resource load errors (img/script) have no error object and are not crashes.
    if (!e.error && !e.message) return;
    report(e.error ?? { name: 'Error', message: e.message });
  });
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}

export async function syncBeta(): Promise<void> {
  try {
    const [{ flushOutbox }, { maybeUploadStats }] = await Promise.all([import('./outbox'), import('./stats')]);
    await maybeUploadStats();
    await flushOutbox();
  } catch {
    // Retried on the next sync.
  }
}

/** Installs the handlers and syncs on start, when the device comes online and every 15 minutes. */
export function startBeta(): void {
  if (!collectorUrl() || typeof window === 'undefined') return;
  installCrashHandlers();
  const sync = () => void syncBeta();
  window.addEventListener('online', sync);
  window.setTimeout(sync, 3000);
  window.setInterval(() => {
    if (document.visibilityState === 'visible') sync();
  }, SYNC_EVERY_MS);
}
