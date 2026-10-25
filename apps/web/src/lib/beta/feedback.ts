// "Report a problem" on one exercise: the learner sees exactly what is sent, and it is sent only
// when they press Send. A copy stays on the device ("My reports").
import type { FeedbackReport } from '@doppelpunkt/beta-schema';
import { db } from '../../db';
import { APP_VERSION, isOnline } from './config';
import { enqueue, flushOutbox } from './outbox';

export type Reason = FeedbackReport['reason'];

export const REASONS: Array<{ id: Reason; label: string }> = [
  { id: 'wrong-answer', label: 'Wrong answer' },
  { id: 'unclear', label: 'Unclear' },
  { id: 'typo', label: 'Typo' },
  { id: 'audio', label: 'Audio' },
  { id: 'swiss-form', label: 'Swiss form' },
  { id: 'other', label: 'Other' },
];

export const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.id, r.label])) as Record<Reason, string>;

export type ReportTarget = { itemId: string; unitId: string; contentVersion: string; answer?: string };

export function buildFeedbackReport(
  target: ReportTarget,
  input: { reason: Reason; comment?: string; includeAnswer?: boolean },
  at = new Date(),
): FeedbackReport {
  const comment = input.comment?.trim().slice(0, 500);
  const answer = input.includeAnswer ? target.answer?.trim().slice(0, 300) : undefined;
  return {
    kind: 'feedback',
    appVersion: APP_VERSION,
    contentVersion: (target.contentVersion || 'unknown').slice(0, 32),
    itemId: target.itemId.slice(0, 120),
    unitId: target.unitId.slice(0, 60),
    reason: input.reason,
    ...(comment ? { comment } : {}),
    ...(answer ? { answer } : {}),
    at: at.toISOString(),
  };
}

export type SubmitResult = 'sent' | 'queued' | 'failed';

/** Saves the report locally, queues it and tries to send it now. */
export async function submitReport(report: FeedbackReport, fetchImpl: typeof fetch = fetch): Promise<SubmitResult> {
  const reportId = await db.transaction('rw', db.outbox, db.reports, async () => {
    const outboxId = await enqueue(report);
    return db.reports.add({ report, outboxId, status: 'queued' });
  });
  if (!isOnline()) return 'queued';
  await flushOutbox(fetchImpl);
  const row = await db.reports.get(reportId);
  return row?.status ?? 'queued';
}
