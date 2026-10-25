import { Link } from 'react-router-dom';
import type { Settings } from '../db';
import { betaActive } from '../lib/beta/config';
import { betaOf } from '../lib/beta/prefs';
import { BetaToggles } from './BetaToggles';

/** Settings → "Help improve Doppelpunkt (beta)". */
export function BetaSettings({ settings, fetchImpl }: { settings: Settings; fetchImpl?: typeof fetch }) {
  if (!betaActive()) {
    return (
      <div className="card space-y-2 text-sm">
        <p>The beta programme is not active in this build. Nothing is ever sent from this app: no feedback, statistics or crash reports.</p>
        <Link to="/privacy" className="text-accent underline">
          Privacy
        </Link>
      </div>
    );
  }
  const beta = betaOf(settings);
  return (
    <div className="card space-y-3">
      <p className="text-sm text-muted">
        You're using a beta build. Everything below is off until you turn it on, and you can turn it off at any time.
      </p>
      <BetaToggles beta={beta} fetchImpl={fetchImpl} />
      {beta.stats && beta.installId && (
        <p className="text-xs text-muted">
          Your random beta id: <code className="font-mono">{beta.installId.slice(0, 8)}…</code>
          {beta.installIdAt ? `, created ${new Date(beta.installIdAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.
          It is replaced after 90 days and deleted when you turn statistics off.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to="/beta" className="text-accent underline">
          Beta feedback and my reports
        </Link>
        <Link to="/privacy" className="text-accent underline">
          Privacy
        </Link>
      </div>
    </div>
  );
}
