import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../content';
import { betaActive } from '../lib/beta/config';
import type { ReportTarget, SubmitResult } from '../lib/beta/feedback';

const ReportForm = lazy(() => import('../beta/ReportForm').then((m) => ({ default: m.ReportForm })));

const DONE_TEXT: Record<SubmitResult, string> = {
  sent: 'Sent. Thank you!',
  queued: "Saved. Will send when you're online.",
  failed: "The beta server didn't accept this report. It's kept on this device under My reports.",
};

/**
 * "Report a problem" for one exercise (beta builds only). Opens an inline form; nothing is sent
 * until the learner presses Send.
 */
export function ReportProblem({ target, className = '' }: { target: Omit<ReportTarget, 'contentVersion'> & { contentVersion?: string }; className?: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<SubmitResult>();
  const packVersion = useContent((s) => (s.packs.find((p) => p.units.some((u) => u.id === target.unitId)) ?? s.packs[0])?.version);
  if (!betaActive()) return null;
  const full: ReportTarget = { ...target, contentVersion: target.contentVersion ?? packVersion ?? 'unknown' };

  return (
    <div className={className}>
      {!open && !done && (
        <button type="button" className="btn-ghost px-2 text-sm text-muted" onClick={() => setOpen(true)}>
          <span aria-hidden="true">⚑</span> Report a problem
        </button>
      )}
      {open && (
        <Suspense fallback={<p role="status" className="text-sm text-muted">Loading…</p>}>
          <ReportForm
            target={full}
            onCancel={() => setOpen(false)}
            onDone={(r) => {
              setOpen(false);
              setDone(r);
            }}
          />
        </Suspense>
      )}
      {done && (
        <p role="status" className={`text-sm ${done === 'failed' ? 'text-bad' : 'text-ok'}`}>
          {DONE_TEXT[done]}{' '}
          <Link to="/beta#reports" className="text-accent underline">
            My reports
          </Link>
        </p>
      )}
    </div>
  );
}
