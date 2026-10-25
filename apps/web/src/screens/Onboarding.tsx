import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateSettings, type Dialect } from '../db';
import { Logo } from '../components/Logo';
import { GermanText } from '../components/GermanText';
import { useSettings } from '../lib/hooks';

const GOALS = [5, 10, 15, 20, 30];

const DIALECTS: Array<{ id: Dialect; name: string; city: string; sample: string }> = [
  { id: 'gsw-zh', name: 'Züritüütsch', city: 'Zurich', sample: 'Grüezi mitenand! Wie gaats?' },
  { id: 'gsw-be', name: 'Bärndütsch', city: 'Bern', sample: 'Grüessech mitenand! Wie geits?' },
];

type Step = 'welcome' | 'dialect' | 'goal' | 'start';

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [dialect, setDialect] = useState<Dialect>('gsw-zh');
  const [goal, setGoal] = useState(10);

  const settings = useSettings();
  const [target, setTarget] = useState<string>();

  // Navigate only once the saved settings are visible, so the onboarding gate doesn't bounce us back.
  useEffect(() => {
    if (target && settings?.onboarded) navigate(target, { replace: true });
  }, [target, settings?.onboarded, navigate]);

  const finish = async (placement: boolean) => {
    await updateSettings({ onboarded: true, dialect, dailyGoalMin: goal, level: 'A1', startUnit: 1 });
    setTarget(placement ? '/placement' : '/learn');
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      {step === 'welcome' && (
        <section className="space-y-5 text-center" aria-labelledby="welcome-title">
          <div className="flex justify-center">
            <Logo size={72} />
          </div>
          <h1 id="welcome-title" className="text-3xl font-bold tracking-tight">
            Doppelpunkt
          </h1>
          <p className="text-muted">
            Learn <span className="font-semibold text-gold-strong">Standard German</span> and{' '}
            <span className="font-semibold text-swiss-strong">Swiss German</span> side by side, from A1 to C2. Works offline; your progress stays
            on this device.
          </p>
          <div className="card space-y-2 text-left">
            <GermanText text="Guten Tag! Wie geht es Ihnen?" variety="de" audio />
            <GermanText text="Grüezi! Wie gaats Ine?" variety="gsw-zh" audio />
          </div>
          <button type="button" className="btn-primary w-full" onClick={() => setStep('dialect')}>
            Get started
          </button>
        </section>
      )}

      {step === 'dialect' && (
        <section className="space-y-4" aria-labelledby="dialect-title">
          <h1 id="dialect-title" className="text-2xl font-bold">
            Which Swiss German do you want to hear?
          </h1>
          <p className="text-sm text-muted">The Swiss lane in every unit uses this dialect. You can change it later.</p>
          <div role="radiogroup" aria-labelledby="dialect-title" className="grid gap-3">
            {DIALECTS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={dialect === d.id}
                onClick={() => setDialect(d.id)}
                className={`card text-left ${dialect === d.id ? 'border-swiss ring-2 ring-swiss/40' : ''}`}
              >
                <span className="block text-lg font-semibold">
                  {d.city} — {d.name}
                </span>
                <GermanText as="span" text={d.sample} variety={d.id} className="mt-1 text-sm" />
              </button>
            ))}
          </div>
          <Nav onBack={() => setStep('welcome')} onNext={() => setStep('goal')} />
        </section>
      )}

      {step === 'goal' && (
        <section className="space-y-4" aria-labelledby="goal-title">
          <h1 id="goal-title" className="text-2xl font-bold">
            How much time per day?
          </h1>
          <div role="radiogroup" aria-labelledby="goal-title" className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={goal === g}
                onClick={() => setGoal(g)}
                className={`chip px-4 py-2 ${goal === g ? 'border-accent bg-accent-soft text-accent' : ''}`}
              >
                {g} min
              </button>
            ))}
          </div>
          <Nav onBack={() => setStep('dialect')} onNext={() => setStep('start')} />
        </section>
      )}

      {step === 'start' && (
        <section className="space-y-4" aria-labelledby="start-title">
          <h1 id="start-title" className="text-2xl font-bold">
            Where do you want to start?
          </h1>
          <button type="button" className="card w-full text-left" onClick={() => finish(false)}>
            <span className="block font-semibold">I'm new to German</span>
            <span className="text-sm text-muted">Start at A1, unit 1.</span>
          </button>
          <button type="button" className="card w-full text-left" onClick={() => finish(true)}>
            <span className="block font-semibold">I know some German</span>
            <span className="text-sm text-muted">Take a short placement test (about 5 minutes).</span>
          </button>
          <button type="button" className="btn-ghost" onClick={() => setStep('goal')}>
            Back
          </button>
        </section>
      )}
    </main>
  );
}

function Nav({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex justify-between">
      <button type="button" className="btn-ghost" onClick={onBack}>
        Back
      </button>
      <button type="button" className="btn-primary" onClick={onNext}>
        Continue
      </button>
    </div>
  );
}
