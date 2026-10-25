import { useState } from 'react';
import type { CompiledUnit } from '@doppelpunkt/content-schema';
import { gradeWriting, WRITING_CRITERIA, type WritingFeedback } from '@doppelpunkt/ai';
import { db } from '../db';
import { GermanText } from '../components/GermanText';
import { aiUnavailableMessage, errorMessage, useAi } from '../lib/ai';
import { recordAttempt } from '../lib/progress';
import type { ExerciseOf, ExerciseOutcome } from './types';

/** Averages the rubric criteria (each 0–5, see WRITING_CRITERIA) to 0..1. */
export function writingScore(scores: Record<string, number>): number {
  const vals = WRITING_CRITERIA.map((k) => scores[k]).filter((v): v is number => Number.isFinite(v));
  if (!vals.length) return 0;
  return Math.max(0, Math.min(1, vals.reduce((a, b) => a + b, 0) / vals.length / 5));
}

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type Props = { ex: ExerciseOf<'write'>; unit: CompiledUnit; record: boolean; onDone: (o: ExerciseOutcome) => void };

export function WriteTask({ ex, unit, record, onDone }: Props) {
  const ai = useAi('writing');
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'writing' | 'grading' | 'self' | 'done'>('writing');
  const [feedback, setFeedback] = useState<WritingFeedback>();
  const [checks, setChecks] = useState<boolean[]>(() => ex.checklist.map(() => false));
  const [error, setError] = useState<string>();
  const words = countWords(text);
  const enough = !ex.minWords || words >= ex.minWords;

  const finish = async (score: number, extra: { feedback?: WritingFeedback; selfCheck?: boolean[] }) => {
    await db.writingSubmissions.add({ exerciseId: ex.id, unitId: unit.id, text, at: new Date().toISOString(), score, ...extra });
    if (record) await recordAttempt(ex, unit, score, extra.feedback?.errors.map((e) => e.type));
    setPhase('done');
    onDone({ exerciseId: ex.id, score, correct: score >= 0.7 });
  };

  const submitAi = async () => {
    if (ai.status !== 'ready') return;
    setPhase('grading');
    setError(undefined);
    try {
      const fb = await gradeWriting(ai.provider, ex, text, unit.level);
      setFeedback(fb);
      await finish(writingScore(fb.scores), { feedback: fb });
    } catch (e) {
      setError(errorMessage(e));
      setPhase('writing');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-base">{ex.task}</p>
      <label htmlFor={`write-${ex.id}`} className="label">
        Your text {ex.minWords ? `(at least ${ex.minWords} words)` : ''}
      </label>
      <textarea
        id={`write-${ex.id}`}
        rows={7}
        lang="de"
        className="input"
        value={text}
        disabled={phase !== 'writing'}
        onChange={(e) => setText(e.target.value)}
      />
      <p className={`text-xs ${enough ? 'text-muted' : 'text-bad'}`} aria-live="polite">
        {words} words
      </p>

      {phase === 'writing' && (
        <div className="flex flex-wrap gap-2">
          {ai.status === 'ready' && (
            <button type="button" className="btn-primary" disabled={!enough || !text.trim()} onClick={submitAi}>
              Get AI feedback
            </button>
          )}
          <button type="button" className={ai.status === 'ready' ? 'btn-secondary' : 'btn-primary'} disabled={!text.trim()} onClick={() => setPhase('self')}>
            Check it myself
          </button>
          {ai.status !== 'ready' && <p className="w-full text-xs text-muted">{aiUnavailableMessage(ai)}</p>}
        </div>
      )}
      {phase === 'grading' && <p role="status">Your tutor is reading your text…</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {phase === 'self' && (
        <fieldset className="card space-y-2">
          <legend className="px-1 text-sm font-semibold">Check your text</legend>
          {ex.checklist.map((c, i) => (
            <label key={i} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={checks[i] ?? false}
                onChange={(e) => setChecks(checks.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              {c}
            </label>
          ))}
          <ModelAnswer text={ex.model} />
          <button type="button" className="btn-primary" onClick={() => finish(checks.filter(Boolean).length / checks.length, { selfCheck: checks })}>
            Save
          </button>
        </fieldset>
      )}

      {phase === 'done' && feedback && <WritingReport fb={feedback} />}
      {phase === 'done' && <ModelAnswer text={ex.model} />}
      {phase === 'done' && <p className="text-sm">{ex.explanation}</p>}
    </div>
  );
}

function ModelAnswer({ text }: { text: string }) {
  return (
    <details className="rounded-xl bg-surface-2 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Model answer</summary>
      <GermanText text={text} variety="de" className="mt-2 whitespace-pre-wrap" />
    </details>
  );
}

export function WritingReport({ fb }: { fb: WritingFeedback }) {
  return (
    <div className="card space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Corrected</p>
        <GermanText text={fb.corrected} variety="de" className="whitespace-pre-wrap" />
      </div>
      {fb.errors.length > 0 && (
        <ul className="space-y-2 text-sm">
          {fb.errors.map((e, i) => (
            <li key={i} className="rounded-lg bg-surface-2 p-2">
              <span className="text-bad line-through">{e.original}</span> → <span className="font-medium text-ok">{e.correction}</span>
              <span className="ml-2 rounded bg-accent-soft px-1.5 text-xs text-accent">{e.type}</span>
              <p className="mt-1 text-muted">{e.explanation}</p>
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {Object.entries(fb.scores).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface-2 p-2">
            <dt className="text-xs capitalize text-muted">{k}</dt>
            <dd className="font-semibold">{v} / 5</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        <span className="font-semibold">Focus next:</span> {fb.focusNext}
      </p>
    </div>
  );
}
