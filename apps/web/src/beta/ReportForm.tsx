import { useId, useMemo, useRef, useEffect, useState } from 'react';
import { buildFeedbackReport, REASONS, submitReport, type Reason, type ReportTarget, type SubmitResult } from '../lib/beta/feedback';
import { errorMessage } from '../lib/ai';

/** Reason chips, optional comment and answer, a preview of exactly what will be sent, then Send. */
export function ReportForm({
  target,
  onCancel,
  onDone,
  fetchImpl,
}: {
  target: ReportTarget;
  onCancel: () => void;
  onDone: (r: SubmitResult) => void;
  fetchImpl?: typeof fetch;
}) {
  const uid = useId();
  const [reason, setReason] = useState<Reason>();
  const [comment, setComment] = useState('');
  const [includeAnswer, setIncludeAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // The time is fixed when the form opens, so the preview is exactly what is sent.
  const [at] = useState(() => new Date());
  const legend = useRef<HTMLLegendElement>(null);
  useEffect(() => legend.current?.focus(), []);

  const hasAnswer = !!target.answer?.trim();
  const report = useMemo(
    () => (reason ? buildFeedbackReport(target, { reason, comment, includeAnswer: hasAnswer && includeAnswer }, at) : undefined),
    [target, reason, comment, includeAnswer, hasAnswer, at],
  );

  const send = async () => {
    if (!report || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      onDone(await submitReport(report, fetchImpl));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    // Not a <form>: it is shown inside the exercise's own form (Feedback), and nested forms submit
    // natively (a page navigation). Keys stay here, so Enter on a reason doesn't move to the next item.
    <div
      role="form"
      aria-labelledby={`${uid}-title`}
      className="space-y-3 rounded-xl border border-line bg-surface p-3"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h4 id={`${uid}-title`} className="font-semibold">
        Report a problem
      </h4>
      <fieldset>
        <legend ref={legend} tabIndex={-1} className="mb-2 text-sm font-medium">
          What's wrong with this exercise?
        </legend>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <label
              key={r.id}
              className={`chip cursor-pointer gap-1.5 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                reason === r.id ? 'border-accent bg-accent-soft text-accent' : ''
              }`}
            >
              <input type="radio" name={`${uid}-reason`} value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="sr-only" />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${uid}-comment`} className="label">
          Comment (optional)
        </label>
        <textarea
          id={`${uid}-comment`}
          className="input min-h-20"
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={`${uid}-hint`}
        />
        <p id={`${uid}-hint`} className="mt-1 text-xs text-muted">
          Please don't include personal details (names, email addresses, phone numbers). {500 - comment.length} characters left.
        </p>
      </div>
      {hasAnswer && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={includeAnswer} onChange={(e) => setIncludeAnswer(e.target.checked)} />
          <span>Include my answer</span>
        </label>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted" id={`${uid}-preview`}>
          Exactly what will be sent
        </p>
        {report ? (
          <pre aria-labelledby={`${uid}-preview`} className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 text-xs">
            {JSON.stringify(report, null, 2)}
          </pre>
        ) : (
          <p className="mt-1 text-sm text-muted">Choose what's wrong to see the report.</p>
        )}
        <p className="mt-1 text-xs text-muted">Nothing else is sent: no name, email address or API key. A copy stays on this device.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={!report || busy} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
