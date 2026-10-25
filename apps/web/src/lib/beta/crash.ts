// Crash reports (opt-in): name, message, stack and route, scrubbed on the device before they are
// queued. Never includes IndexedDB contents, answers or keys.
import type { CrashReport } from '@doppelpunkt/beta-schema';
import { APP_VERSION, collectorUrl } from './config';
import { enqueue, flushOutbox } from './outbox';
import { getBeta } from './prefs';
import { browserName, scrubRoute, scrubStack, scrubText } from './scrub';

const MAX_PER_SESSION = 5;
const seen = new Set<string>();

function parts(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message, stack: error.stack };
  if (typeof error === 'object' && error !== null) {
    const o = error as { name?: unknown; message?: unknown; stack?: unknown; status?: unknown; statusText?: unknown };
    // React Router route errors (e.g. a 404 response) carry status and statusText.
    if (typeof o.status === 'number') return { name: 'RouteError', message: `${o.status} ${String(o.statusText ?? '')}`.trim() };
    return { name: typeof o.name === 'string' ? o.name : 'Error', message: typeof o.message === 'string' ? o.message : 'Unknown error', stack: typeof o.stack === 'string' ? o.stack : undefined };
  }
  return { name: 'Error', message: String(error) };
}

export function buildCrashReport(error: unknown, route: string, at = new Date(), ua?: string): CrashReport {
  const p = parts(error);
  const stack = p.stack ? scrubStack(p.stack, 4000) : '';
  return {
    kind: 'crash',
    appVersion: APP_VERSION,
    name: scrubText(p.name, 100) || 'Error',
    message: scrubText(p.message, 500),
    ...(stack ? { stack } : {}),
    route: scrubRoute(route),
    browser: browserName(ua),
    at: at.toISOString(),
  };
}

const currentRoute = () => (typeof location !== 'undefined' ? location.pathname : '/');

/** Queues a scrubbed crash report when the learner opted in (at most 5 per session, no duplicates). */
export async function reportCrash(error: unknown, route = currentRoute(), fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    if (!collectorUrl() || !(await getBeta()).crashes) return false;
    const report = buildCrashReport(error, route);
    const key = `${report.name}|${report.message}|${report.route}`;
    if (seen.has(key) || seen.size >= MAX_PER_SESSION) return false;
    seen.add(key);
    if ((await enqueue(report)) === undefined) return false;
    void flushOutbox(fetchImpl);
    return true;
  } catch {
    return false;
  }
}

/** For tests. */
export function resetCrashSession(): void {
  seen.clear();
}
