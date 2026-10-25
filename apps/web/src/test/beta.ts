// Helpers for beta tests: a stubbed collector URL, a recording fetch mock and a clean database.
import { vi } from 'vitest';
import { db } from '../db';

export const COLLECTOR = 'https://collector.test';

export type Call = { url: string; body: unknown };

/** A fetch mock that records calls and answers with the given responder (default 200). */
export function mockFetch(respond: (call: Call, n: number) => Response | Promise<Response> = () => json(200, { accepted: 1, rejected: 0 })) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return respond(call, calls.length);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export async function clearBetaDb(): Promise<void> {
  await Promise.all([db.settings.clear(), db.outbox.clear(), db.reports.clear(), db.itemStats.clear(), db.attempts.clear(), db.unitStatus.clear()]);
}

export function setOnline(online: boolean) {
  return vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
}
