// Contract between the app and the optional beta collector (services/collector).
// Everything here is opt-in and carries no personal data: no names, emails, free-text
// answers, IP addresses or API keys. See docs/PRIVACY.md.
import { z } from 'zod';

/**
 * Random id created on the device when the learner opts in, rotated every 90 days and
 * deleted when they opt out. Used only to count retention cohorts, never joined with anything else.
 */
export const InstallId = z.string().regex(/^[a-f0-9]{32}$/);

const appVersion = z.string().max(32);
const itemId = z.string().max(120);

/** "This is wrong / unclear" report on one exercise. */
export const FeedbackReport = z.object({
  kind: z.literal('feedback'),
  appVersion,
  contentVersion: z.string().max(32),
  itemId,
  unitId: z.string().max(60),
  reason: z.enum(['wrong-answer', 'unclear', 'typo', 'audio', 'swiss-form', 'other']),
  /** Optional short comment; the app warns not to include personal data. */
  comment: z.string().max(500).optional(),
  /** The answer the learner gave, only when they tick "include my answer". */
  answer: z.string().max(300).optional(),
  at: z.string().datetime(),
});
export type FeedbackReport = z.infer<typeof FeedbackReport>;

/** Aggregated per-item results since the last upload (counts only). */
export const ItemStat = z.object({
  itemId,
  attempts: z.number().int().nonnegative(),
  /** First-try score buckets: [0, 0.5), [0.5, 0.8), [0.8, 1]. */
  buckets: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()]),
  /** Total seconds spent, rounded to 5 s. */
  seconds: z.number().int().nonnegative(),
});
export type ItemStat = z.infer<typeof ItemStat>;

export const StatsBatch = z.object({
  kind: z.literal('stats'),
  appVersion,
  contentVersion: z.string().max(32),
  installId: InstallId,
  /** Learner's level band from the skill estimate, e.g. "A1+"; coarse on purpose. */
  band: z.string().max(4).optional(),
  /** ISO date (day only) of this upload, for retention. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(ItemStat).max(500),
});
export type StatsBatch = z.infer<typeof StatsBatch>;

export const CrashReport = z.object({
  kind: z.literal('crash'),
  appVersion,
  /** Error name and message with URLs, emails and long numbers scrubbed on the device. */
  name: z.string().max(100),
  message: z.string().max(500),
  /** Stack with file paths reduced to bundle file names. */
  stack: z.string().max(4000).optional(),
  route: z.string().max(100),
  browser: z.string().max(60),
  at: z.string().datetime(),
});
export type CrashReport = z.infer<typeof CrashReport>;

export const BetaEnvelope = z.discriminatedUnion('kind', [FeedbackReport, StatsBatch, CrashReport]);
export type BetaEnvelope = z.infer<typeof BetaEnvelope>;

/** Endpoints on the collector. POST bodies are one envelope or an array of up to 50. */
export const ENDPOINTS = { ingest: '/v1/ingest', health: '/v1/health', export: '/v1/export' } as const;

/** Shape returned by GET /v1/export (authenticated, for tools/ item statistics). */
export const ExportDump = z.object({
  generatedAt: z.string(),
  feedback: z.array(FeedbackReport),
  stats: z.array(StatsBatch.omit({ installId: true }).extend({ cohort: z.string() })),
  crashes: z.array(CrashReport),
  /** Retention: installs first seen per ISO week and how many were active in weeks 1–4 after. */
  retention: z.array(z.object({ cohortWeek: z.string(), installs: z.number().int(), activeWeek: z.array(z.number().int()).length(4) })),
});
export type ExportDump = z.infer<typeof ExportDump>;
