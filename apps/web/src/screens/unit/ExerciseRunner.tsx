import { useState } from 'react';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { ExercisePlayer } from '../../exercise/ExercisePlayer';
import { useAttempts } from '../../lib/hooks';

/** Steps through a list of exercises, one at a time, with a status strip. */
export function ExerciseRunner({ unit, exercises, label }: { unit: CompiledUnit; exercises: Exercise[]; label: string }) {
  const attempts = useAttempts(unit.id);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [round, setRound] = useState(0);

  if (!exercises.length) return <p className="text-sm text-muted">No exercises here yet.</p>;
  const current = exercises[Math.min(index, exercises.length - 1)];
  if (!current) return null;

  const best = (id: string) => {
    const scores = (attempts ?? []).filter((a) => a.exerciseId === id).map((a) => a.score);
    return scores.length ? Math.max(...scores) : undefined;
  };

  const go = (i: number) => {
    setIndex(i);
    setAnswered(false);
  };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-1.5" aria-label={`${label}: ${exercises.length} items`}>
        {exercises.map((ex, i) => {
          const s = best(ex.id);
          const tone = s === undefined ? 'bg-surface-2 text-muted' : s >= 0.7 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad';
          return (
            <li key={ex.id}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === index ? 'step' : undefined}
                aria-label={`Item ${i + 1}${s === undefined ? '' : `, best ${Math.round(s * 100)}%`}`}
                className={`h-8 w-8 rounded-lg text-xs font-semibold ${tone} ${i === index ? 'ring-2 ring-accent' : ''}`}
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <ExercisePlayer key={`${current.id}-${round}`} exercise={current} unit={unit} onDone={() => setAnswered(true)} />
      <div className="flex justify-between gap-2">
        <button type="button" className="btn-ghost" disabled={index === 0} onClick={() => go(index - 1)}>
          Previous
        </button>
        {answered && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setRound(round + 1);
              setAnswered(false);
            }}
          >
            Try again
          </button>
        )}
        <button type="button" className="btn-primary" disabled={index >= exercises.length - 1} onClick={() => go(index + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
