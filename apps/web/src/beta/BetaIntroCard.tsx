import { Link } from 'react-router-dom';
import type { BetaPrefs } from '../db';
import { finishBetaIntro } from '../lib/beta/prefs';
import { BetaToggles } from './BetaToggles';

/** One-time card after onboarding (beta builds only). Dismissing it keeps everything off. */
export function BetaIntroCard({ beta }: { beta: BetaPrefs }) {
  return (
    <section className="card space-y-3 border-gold/50" aria-labelledby="beta-intro-title">
      <h2 id="beta-intro-title" className="text-lg font-semibold">
        Help improve Doppelpunkt (beta)
      </h2>
      <p className="text-sm text-muted">
        This is a beta. If you like, you can help us find exercises that are wrong or too hard. Everything is off unless you turn it on here
        or later in Settings.
      </p>
      <BetaToggles beta={beta} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={beta.stats || beta.crashes ? 'btn-primary' : 'btn-secondary'} onClick={() => void finishBetaIntro()}>
          {beta.stats || beta.crashes ? 'Done' : 'Not now'}
        </button>
        <Link to="/privacy" className="text-sm text-accent underline">
          Privacy
        </Link>
      </div>
    </section>
  );
}
