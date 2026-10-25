import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashReport } from '@doppelpunkt/beta-schema';
import { db } from '../../db';
import { clearBetaDb, COLLECTOR, mockFetch } from '../../test/beta';
import { buildCrashReport, reportCrash, resetCrashSession } from './crash';
import { setCrashOptIn } from './prefs';
import { latestChangelogSection } from './changelog';
import { learnerPrivacyText } from './privacy';

beforeEach(async () => {
  vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
  resetCrashSession();
  await clearBetaDb();
});
afterEach(() => vi.unstubAllEnvs());

const err = () => {
  const e = new TypeError('Cannot read key sk-ant-api03-FAKEfake0123456789 of user anna@example.ch (id 9876543)');
  e.stack = `${e.message}\n    at render (https://doppelpunkt.app/assets/index-AbC.js:1:23456)`;
  return e;
};

describe('crash reports', () => {
  it('are scrubbed and valid against the contract', () => {
    const r = buildCrashReport(err(), '/unit/a1-u01?x=anna@example.ch', new Date('2026-10-25T10:00:00Z'), 'Chrome/131.0 Safari/537.36');
    expect(CrashReport.safeParse(r).success).toBe(true);
    expect(r.message).toBe('Cannot read key [key] of user [email] (id [n])');
    expect(r.stack).toContain('index-AbC.js:1:23456');
    expect(JSON.stringify(r)).not.toMatch(/sk-ant|anna@|doppelpunkt\.app|9876543/);
    expect(r).toMatchObject({ name: 'TypeError', route: '/unit/a1-u01', browser: 'Chrome 131' });
  });

  it('handle non-Error values', () => {
    expect(buildCrashReport('plain string', '/').message).toBe('plain string');
    expect(buildCrashReport({ status: 404, statusText: 'Not Found' }, '/').message).toBe('404 Not Found');
  });

  it('are queued only when opted in, once per error', async () => {
    const m = mockFetch();
    expect(await reportCrash(err(), '/learn', m.fetch)).toBe(false);
    expect(await db.outbox.count()).toBe(0);
    await setCrashOptIn(true);
    expect(await reportCrash(err(), '/learn', m.fetch)).toBe(true);
    expect(await reportCrash(err(), '/learn', m.fetch)).toBe(false);
    await vi.waitFor(() => expect(m.calls).toHaveLength(1));
    const body = m.calls[0]!.body as CrashReport[];
    expect(body[0]!.kind).toBe('crash');
    // Never anything from IndexedDB: only the contract's fields.
    expect(Object.keys(body[0]!).sort()).toEqual(['appVersion', 'at', 'browser', 'kind', 'message', 'name', 'route', 'stack']);
  });

  it('opting out drops unsent crash reports', async () => {
    await setCrashOptIn(true);
    vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await reportCrash(err(), '/learn');
    expect(await db.outbox.count()).toBe(1);
    await setCrashOptIn(false);
    expect(await db.outbox.count()).toBe(0);
    vi.restoreAllMocks();
  });

  it('are never sent without a collector', async () => {
    await setCrashOptIn(true);
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    expect(await reportCrash(err(), '/learn')).toBe(false);
  });
});

describe('changelog and privacy text', () => {
  it('takes the newest changelog section', () => {
    const md = '# Changelog\n\n## 0.5.0 "Beta"\n\n- Feedback\n- Stats\n\n## 0.4.0\n\n- Old';
    expect(latestChangelogSection(md)).toEqual({ title: '0.5.0 "Beta"', body: '- Feedback\n- Stats' });
    expect(latestChangelogSection('nothing')).toBeUndefined();
  });

  it('drops the title and the operator notes from the privacy notice', () => {
    const md = '# Privacy\n\nIntro.\n\n## Short\n\n- a\n\n---\n\n## Notes for the operator\n\nSecret stuff';
    expect(learnerPrivacyText(md)).toBe('Intro.\n\n## Short\n\n- a');
  });
});
