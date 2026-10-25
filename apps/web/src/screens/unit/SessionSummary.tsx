import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { ProgressBar } from '../../components/ProgressBar';
import { skillLabel } from '../../components/SkillRadar';
import { formatDuration, sessionStats, wordsInExercises, type Session } from '../../lib/practice';
import { addVocab } from '../../lib/progress';

type Props = {
  unit: CompiledUnit;
  exercises: Exercise[];
  session: Session;
  durationSec: number;
  onRestart: () => void;
  onOpen: (exerciseId: string) => void;
};

/** End-of-set screen: first-attempt score, time, per-skill breakdown and the mistakes to look at again. */
export function SessionSummary({ unit, exercises, session, durationSec, onRestart, onOpen }: Props) {
  const stats = useMemo(() => sessionStats(exercises, session), [exercises, session]);
  const missed = useMemo(() => wordsInExercises(unit, stats.mistakes), [unit, stats.mistakes]);
  const [added, setAdded] = useState<number>();
  const pct = Math.round(stats.score * 100);

  return (
    <section className="card space-y-4" aria-labelledby="summary-title">
      <div>
        <h2 id="summary-title" className="text-lg font-bold">
          Session summary
        </h2>
        <p className="text-sm text-muted">
          {stats.answered} of {stats.total} items answered · {formatDuration(durationSec)}
        </p>
      </div>

      {stats.answered === 0 ? (
        <p className="text-sm">You haven't answered any items in this set yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-2 p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Score</p>
              <p className="text-2xl font-bold tabular-nums">{pct}%</p>
              <p className="text-xs text-muted">first attempts only</p>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <p className="text-xs uppercase tracking-wide text-muted">Right first time</p>
              <p className="text-2xl font-bold tabular-nums">
                {stats.rightFirstTime} / {stats.answered}
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">By skill</h3>
            <ul className="space-y-2" aria-label="Score by skill">
              {stats.perSkill.map((s) => (
                <li key={s.skill} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-2 text-sm">
                  <span>{skillLabel(s.skill)}</span>
                  <ProgressBar value={s.score} label={`${skillLabel(s.skill)} score`} />
                  <span className="text-right tabular-nums text-muted">{Math.round(s.score * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Mistakes to review</h3>
            {stats.mistakes.length === 0 ? (
              <p className="text-sm text-ok">No mistakes on the first try. Sehr gut!</p>
            ) : (
              <ul className="space-y-1.5 text-sm" aria-label="Mistakes to review">
                {stats.mistakes.map((ex) => {
                  const n = exercises.indexOf(ex) + 1;
                  return (
                    <li key={ex.id} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                      <span className="min-w-0">
                        <span className="text-muted">{n}.</span> {ex.prompt}
                      </span>
                      <Link
                        to={{ search: `?item=${ex.id}` }}
                        className="shrink-0 text-accent hover:underline"
                        onClick={() => onOpen(ex.id)}
                        aria-label={`Practise item ${n} again`}
                      >
                        Practise again
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {missed.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Words from your mistakes</h3>
              <p className="flex flex-wrap gap-1.5" lang="de">
                {missed.map((v) => (
                  <span key={v.id} className="chip bg-surface text-sm">
                    {v.de}
                  </span>
                ))}
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={added !== undefined}
                onClick={async () => setAdded(await addVocab(unit, missed.map((v) => v.id)))}
              >
                Add missed words to review
              </button>
              {added !== undefined && (
                <p role="status" className="text-sm text-ok">
                  {added ? `Added ${added} word${added === 1 ? '' : 's'} to your review deck.` : 'These words are already in your review deck.'}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onRestart}>
          Practise this set again
        </button>
        {stats.answered > 0 && (
          <Link to="/review" className="btn-ghost">
            Go to review
          </Link>
        )}
      </div>
    </section>
  );
}
