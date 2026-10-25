import type { CrashReport, FeedbackReport, StatsBatch } from '@doppelpunkt/beta-schema';

export const NOW = Date.parse('2026-10-21T12:00:00Z'); // Wednesday, ISO week 2026-W43
export const DAY = 86_400_000;
export const ID_A = 'a'.repeat(32);
export const ID_B = '0123456789abcdef0123456789abcdef';
export const ENV = { INSTALL_SECRET: 'install-secret', RATE_SALT: 'rate-salt', EXPORT_TOKEN: 'export-token' };

export const feedback = (over: Partial<FeedbackReport> = {}): FeedbackReport => ({
  kind: 'feedback', appVersion: '0.5.0', contentVersion: '2026.10.1', itemId: 'a1-u01-ex03', unitId: 'a1-u01',
  reason: 'wrong-answer', at: '2026-10-21T11:59:00.000Z', ...over,
});

export const stats = (over: Partial<StatsBatch> = {}): StatsBatch => ({
  kind: 'stats', appVersion: '0.5.0', contentVersion: '2026.10.1', installId: ID_A, band: 'A1', day: '2026-10-21',
  items: [{ itemId: 'a1-u01-ex03', attempts: 3, buckets: [1, 0, 1], seconds: 40 }], ...over,
});

export const crash = (over: Partial<CrashReport> = {}): CrashReport => ({
  kind: 'crash', appVersion: '0.5.0', name: 'TypeError', message: 'x is undefined', stack: 'at f (index-3f9c0e1a2b4d.js:1:123456)',
  route: '/unit/a1-u01', browser: 'Firefox 140', at: '2026-10-21T11:58:00.000Z', ...over,
});
