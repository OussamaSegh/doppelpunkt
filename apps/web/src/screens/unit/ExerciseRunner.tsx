import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { ExercisePlayer, type ExerciseOutcome } from '../../exercise/ExercisePlayer';
import { useAttempts } from '../../lib/hooks';
import { recordOutcome, type Session } from '../../lib/practice';
import { SessionSummary } from './SessionSummary';

/**
 * Steps through a list of exercises, one at a time, with a status strip. Wrong answers can be
 * retried (the session keeps the first attempt's score); after the last item a summary shows.
 * `?item=<exercise id>` in the URL opens that item.
 */
export function ExerciseRunner({ unit, exercises, label }: { unit: CompiledUnit; exercises: Exercise[]; label: string }) {
  const attempts = useAttempts(unit.id);
  const [params] = useSearchParams();
  const itemParam = params.get('item');
  const startIndex = () => Math.max(0, exercises.findIndex((e) => e.id === itemParam));
  const [index, setIndex] = useState(startIndex);
  const [answered, setAnswered] = useState<ExerciseOutcome>();
  const [round, setRound] = useState(0);
  const [session, setSession] = useState<Session>({});
  const [finishedAt, setFinishedAt] = useState<number>();
  const startedAt = useRef(Date.now());

  // Links from the summary (and the grammar reference) select an item via ?item=.
  useEffect(() => {
    if (!itemParam) return;
    const i = exercises.findIndex((e) => e.id === itemParam);
    if (i < 0) return;
    setIndex(i);
    setAnswered(undefined);
    setFinishedAt(undefined);
  }, [itemParam]);

  if (!exercises.length) return <p className="text-sm text-muted">No exercises here yet.</p>;
  const current = exercises[Math.min(index, exercises.length - 1)];
  if (!current) return null;
  const last = index >= exercises.length - 1;

  const best = (id: string) => {
    const scores = (attempts ?? []).filter((a) => a.exerciseId === id).map((a) => a.score);
    return scores.length ? Math.max(...scores) : undefined;
  };

  const go = (i: number) => {
    setIndex(i);
    setAnswered(undefined);
    setFinishedAt(undefined);
  };
  const finish = () => setFinishedAt(Date.now());
  const next = () => (last ? finish() : go(index + 1));
  const retry = () => {
    setRound(round + 1);
    setAnswered(undefined);
  };

  const strip = (
    <ol className="flex flex-wrap gap-1.5" aria-label={`${label}: ${exercises.length} items`}>
      {exercises.map((ex, i) => {
        const s = best(ex.id);
        const tone = s === undefined ? 'bg-surface-2 text-muted' : s >= 0.7 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad';
        return (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => go(i)}
              aria-current={i === index && finishedAt === undefined ? 'step' : undefined}
              aria-label={`Item ${i + 1}${s === undefined ? '' : `, best ${Math.round(s * 100)}%`}`}
              className={`h-8 w-8 rounded-lg text-xs font-semibold ${tone} ${i === index && finishedAt === undefined ? 'ring-2 ring-accent' : ''}`}
            >
              {i + 1}
            </button>
          </li>
        );
      })}
    </ol>
  );

  if (finishedAt !== undefined) {
    return (
      <div className="space-y-4">
        {strip}
        <SessionSummary
          unit={unit}
          exercises={exercises}
          session={session}
          durationSec={(finishedAt - startedAt.current) / 1000}
          onRestart={() => {
            setSession({});
            startedAt.current = Date.now();
            go(0);
          }}
          onOpen={(id) => go(Math.max(0, exercises.findIndex((e) => e.id === id)))}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {strip}
      <ExercisePlayer
        key={`${current.id}-${round}`}
        exercise={current}
        unit={unit}
        onDone={(o) => {
          setAnswered(o);
          setSession((s) => recordOutcome(s, o));
        }}
        onNext={next}
      />
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="btn-ghost" disabled={index === 0} onClick={() => go(index - 1)}>
          Previous
        </button>
        {answered && !answered.correct && (
          <button type="button" className="btn-secondary" onClick={retry}>
            Try again
          </button>
        )}
        {last ? (
          <button type="button" className="btn-primary" onClick={finish}>
            Finish
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={next}>
            Next
          </button>
        )}
      </div>
      {answered && (
        <p className="hidden text-center text-xs text-muted sm:block">
          Press <kbd className="rounded border border-line px-1">Enter</kbd> for {last ? 'the summary' : 'the next item'}.
        </p>
      )}
    </div>
  );
}
