// /beta: what's new in this build, how to give feedback, what is waiting to be sent, my reports.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import changelog from '../../../../CHANGELOG.md?raw';
import { Markdown } from '../components/Markdown';
import { db, type ReportRow } from '../db';
import { betaActive, isOnline } from '../lib/beta/config';
import { latestChangelogSection } from '../lib/beta/changelog';
import { REASON_LABEL } from '../lib/beta/feedback';
import { flushOutbox, outboxSummary, type FlushResult } from '../lib/beta/outbox';
import { betaOf } from '../lib/beta/prefs';
import { useSettings } from '../lib/hooks';

const latest = latestChangelogSection(changelog);

function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function Beta({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const active = betaActive();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#reports') document.getElementById('reports')?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Doppelpunkt beta</h1>
      {!active && (
        <p className="card text-sm" role="status">
          The beta programme is not active in this build, so nothing is ever sent. You can still read what's new below.
        </p>
      )}

      {latest && (
        <section className="card space-y-2" aria-labelledby="beta-new">
          <h2 id="beta-new" className="text-lg font-semibold">
            What's new in {latest.title}
          </h2>
          <Markdown text={latest.body} className="text-sm" />
        </section>
      )}

      {active && (
        <>
          <section className="card space-y-2" aria-labelledby="beta-how">
            <h2 id="beta-how" className="text-lg font-semibold">
              How to give feedback
            </h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>After you check an answer (or in an exam review or a pronunciation drill), press "Report a problem".</li>
              <li>Pick what's wrong: wrong answer, unclear, typo, audio, Swiss form or other. Add a short comment if you like.</li>
              <li>Look at the preview: that is exactly what will be sent. Press Send.</li>
            </ol>
            <p className="text-sm text-muted">
              Offline? Reports wait on this device and go out when you're back online. Anonymous statistics and crash reports are separate
              choices in <Link to="/settings#s-beta" className="text-accent underline">Settings</Link>. Read the{' '}
              <Link to="/privacy" className="text-accent underline">privacy notes</Link>.
            </p>
          </section>
          <OutboxStatus fetchImpl={fetchImpl} />
        </>
      )}
      <MyReports />
    </div>
  );
}

const FLUSH_TEXT: Record<FlushResult['status'], string> = {
  inactive: 'This build has no beta server.',
  offline: "You're offline. Everything waits on this device.",
  sent: 'Sent.',
  empty: 'Nothing to send.',
  error: "Couldn't reach the beta server. It will try again later.",
};

function OutboxStatus({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const online = useOnline();
  const settings = useSettings();
  const beta = betaOf(settings);
  const waiting = useLiveQuery(() => outboxSummary(), []);
  const statsItems = useLiveQuery(() => db.itemStats.count(), []);
  const [result, setResult] = useState<FlushResult>();
  const [busy, setBusy] = useState(false);
  const total = waiting ? waiting.feedback + waiting.stats + waiting.crash : 0;

  const send = async () => {
    setBusy(true);
    try {
      setResult(await flushOutbox(fetchImpl));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-2" aria-labelledby="beta-outbox">
      <h2 id="beta-outbox" className="text-lg font-semibold">
        Waiting to be sent
      </h2>
      <p className="text-sm">
        <span className={online ? 'text-ok' : 'text-bad'}>{online ? 'Online.' : 'Offline.'}</span>{' '}
        {total === 0 ? 'Nothing is waiting.' : `${total} waiting: ${waiting?.feedback ?? 0} report(s), ${waiting?.stats ?? 0} statistics batch(es), ${waiting?.crash ?? 0} crash report(s).`}
      </p>
      <p className="text-sm text-muted">
        Item statistics: {beta.stats ? `on, ${statsItems ?? 0} exercise(s) counted since the last upload${beta.lastStatsDay ? ` (last upload ${beta.lastStatsDay})` : ''}.` : 'off.'} Crash
        reports: {beta.crashes ? 'on.' : 'off.'}
      </p>
      {total > 0 && (
        <button type="button" className="btn-secondary" onClick={() => void send()} disabled={busy || !online}>
          {busy ? 'Sending…' : 'Send now'}
        </button>
      )}
      {result && (
        <p role="status" className={`text-sm ${result.status === 'error' ? 'text-bad' : 'text-muted'}`}>
          {FLUSH_TEXT[result.status]}
        </p>
      )}
    </section>
  );
}

const STATUS_TEXT: Record<ReportRow['status'], string> = { queued: 'Waiting to send', sent: 'Sent', failed: 'Not accepted' };
const STATUS_CLASS: Record<ReportRow['status'], string> = { queued: 'text-gold-strong', sent: 'text-ok', failed: 'text-bad' };

function MyReports() {
  const rows = useLiveQuery(() => db.reports.reverse().toArray(), []);
  return (
    <section id="reports" className="card space-y-2" aria-labelledby="beta-reports">
      <h2 id="beta-reports" className="text-lg font-semibold">
        My reports
      </h2>
      {!rows ? (
        <p role="status" className="text-sm text-muted">
          Loading…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">You haven't reported anything yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="My reports">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl bg-surface-2 p-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {REASON_LABEL[r.report.reason]} · <span className="font-mono text-xs">{r.report.itemId}</span>
                </span>
                <span className={`text-xs font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_TEXT[r.status]}</span>
              </div>
              <p className="text-xs text-muted">
                {new Date(r.report.at).toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {r.error ? ` · ${r.error}` : ''}
              </p>
              {r.report.comment && <p className="mt-1 whitespace-pre-wrap">{r.report.comment}</p>}
              {r.report.answer && (
                <p className="mt-1 text-xs">
                  Your answer: <span lang="de">{r.report.answer}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
