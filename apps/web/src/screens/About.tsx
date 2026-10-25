// /about: what Doppelpunkt is (the in-app version of public/landing/). Public: reachable before
// onboarding. Lazy-loaded.
import { Link } from 'react-router-dom';
import { formatPrice, productFor } from '@doppelpunkt/license';
import { GermanText } from '../components/GermanText';
import { Logo } from '../components/Logo';
import { billingActive } from '../lib/billing/config';
import { useSettings } from '../lib/hooks';

const PAIRS: Array<{ de: string; ch: string }> = [
  { de: 'Guten Tag! Wie geht es Ihnen?', ch: 'Grüezi! Wie gaats Ine?' },
  { de: 'Ich bin Reto. Wie heißt du?', ch: 'Ich bi de Reto. Wie heissisch du?' },
  { de: 'Woher kommst du?', ch: 'Vo wo chunnsch du?' },
];

const FEATURES: Array<{ title: string; text: string }> = [
  {
    title: 'Standard and Swiss German, side by side',
    text: 'Every unit teaches Standard German and adds a Swiss lane in Zurich or Bern German: what people really say on the tram, at work and at the supermarket checkout.',
  },
  {
    title: 'AI tutors with your own key',
    text: 'Lena, Frau Keller and Reto give feedback on your writing and role-play with you. Bring a key from Anthropic, OpenAI, Google or xAI; it stays encrypted on your device and you pay the provider directly.',
  },
  {
    title: 'Works offline',
    text: 'Install it like an app. Lessons, audio, review and exercises work on the train and in the mountains. Every closed exercise is graded on your device, no AI needed.',
  },
  {
    title: 'Private by design',
    text: 'No account, no tracking, no ads. Your progress stays in your browser; export it whenever you like.',
  },
  {
    title: 'A1 to C2, exam-ready',
    text: 'Units follow the CEFR, with spaced-repetition review, pronunciation drills and timed mock exams in the Goethe, telc and ÖSD style.',
  },
];

export function About() {
  const settings = useSettings();
  const start = settings?.onboarded ? '/learn' : '/welcome';
  const level = productFor('level-a2')?.price;
  const pass = productFor('pass-year')?.price;
  return (
    <div className="space-y-8">
      <header className="space-y-4 text-center">
        <div className="flex justify-center">
          <Logo size={64} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Doppelpunkt</h1>
        <p className="mx-auto max-w-xl text-lg text-muted">
          Learn <span className="font-semibold text-gold-strong">Standard German</span> and{' '}
          <span className="font-semibold text-swiss-strong">Swiss German</span> together, from your first <span lang="de">Grüezi</span> to C2.
        </p>
        <Link to={start} className="btn-primary">
          Open the app
        </Link>
      </header>

      <section aria-labelledby="about-pairs" className="space-y-3">
        <h2 id="about-pairs" className="text-lg font-semibold">
          Two ways to say it
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card space-y-2 border-gold/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-strong">Standard German</p>
            {PAIRS.map((p) => (
              <GermanText key={p.de} text={p.de} variety="de" />
            ))}
          </div>
          <div className="card space-y-2 border-swiss/50">
            <p className="text-xs font-semibold uppercase tracking-wide text-swiss-strong">Swiss German (Zurich)</p>
            {PAIRS.map((p) => (
              <GermanText key={p.ch} text={p.ch} variety="gsw-zh" />
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="about-features" className="space-y-3">
        <h2 id="about-features" className="text-lg font-semibold">
          What you get
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="card space-y-1">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-price" className="card space-y-2">
        <h2 id="about-price" className="text-lg font-semibold">
          Price
        </h2>
        {billingActive() && level && pass ? (
          <p className="text-sm">
            A1 is free, and unit 1 of every level is a free preview. Unlock a level for {formatPrice(level)}, or every level for a year for{' '}
            {formatPrice(pass)}. Book 1 <span lang="de">"Doppelpunkt 1: Ankommen"</span> includes a code for A2.{' '}
            <Link to="/unlock" className="text-accent underline">
              See all options
            </Link>
          </p>
        ) : (
          <p className="text-sm">A1 is free. In this version of the app every level is unlocked.</p>
        )}
      </section>

      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        <Link to="/privacy" className="text-accent underline">
          Privacy policy
        </Link>
        <Link to="/terms" className="text-accent underline">
          Terms of use
        </Link>
        <Link to="/imprint" className="text-accent underline">
          Imprint
        </Link>
      </nav>
    </div>
  );
}
