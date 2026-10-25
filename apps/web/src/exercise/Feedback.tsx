import { useState } from 'react';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { diffWords, type GradeResult } from '@doppelpunkt/engine';
import { explain } from '@doppelpunkt/ai';
import { DiffView } from '../components/DiffView';
import { ReportProblem } from '../components/ReportProblem';
import { GermanText } from '../components/GermanText';
import { aiUnavailableMessage, errorMessage, useAi } from '../lib/ai';
import { resultTone, type ResultTone } from '../lib/feedback';
import { listeningTranscript, TranscriptText } from './Listen';

const TONE_BOX: Record<ResultTone, string> = {
  right: 'border-ok/40 bg-ok-soft',
  almost: 'border-accent/40 bg-accent-soft',
  wrong: 'border-bad/40 bg-bad-soft',
};
const TONE_TEXT: Record<ResultTone, string> = { right: 'text-ok', almost: 'text-accent', wrong: 'text-bad' };

const TEXT_TYPES = new Set<Exercise['type']>(['gap', 'order', 'dictation', 'translate', 'transform', 'speak']);

function solutionVariety(ex: Exercise) {
  return ex.type === 'transform' ? ex.to : ex.variety;
}

export function Feedback({ ex, unit, result, answer }: { ex: Exercise; unit: CompiledUnit; result: GradeResult; answer: string }) {
  const diff = result.diff ?? (TEXT_TYPES.has(ex.type) && !result.correct ? diffWords(result.expected, answer) : []);
  const pct = Math.round(result.score * 100);
  const tone = resultTone(result);
  const transcript = listeningTranscript(ex);
  // The headline already says "Almost!", so the hint doesn't repeat it.
  const hints = tone === 'almost' ? result.feedback.map((f) => f.replace(/^Almost!\s*/, '')).filter(Boolean) : result.feedback;
  return (
    <section aria-live="polite" aria-label="Result" data-tone={tone} className={`mt-4 space-y-3 rounded-2xl border p-4 ${TONE_BOX[tone]}`}>
      <p className={`flex items-baseline gap-2 text-lg font-bold ${TONE_TEXT[tone]}`}>
        <span aria-hidden="true">{tone === 'right' ? '✓' : tone === 'almost' ? '≈' : '✗'}</span>
        <span>{tone === 'right' ? 'Richtig!' : tone === 'almost' ? 'Almost!' : pct > 0 ? `Not quite — ${pct}% right` : 'Not quite'}</span>
      </p>
      {tone === 'almost' && <p className="text-sm">So close: one small slip. Check the solution below.</p>}
      {!result.correct && result.expected && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Solution</p>
          <GermanText text={result.expected} variety={solutionVariety(ex)} audio className="text-base font-medium" />
        </div>
      )}
      {!result.correct && diff.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your answer, word by word</p>
          <DiffView tokens={diff} />
        </div>
      )}
      {hints.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {hints.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {transcript && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">What you heard</p>
          <TranscriptText text={transcript} variety={ex.variety} className="text-sm" />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Explanation</p>
        <p className="text-sm">{ex.explanation}</p>
        {ex.type === 'mcq' && ex.rationales && (
          <ul className="mt-2 space-y-1 text-sm">
            {ex.options.map((o, i) =>
              ex.rationales?.[i] ? (
                <li key={i}>
                  <span className="font-medium">{o}:</span> {ex.rationales[i]}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
      <WhyButton ex={ex} unit={unit} answer={answer} />
      <ReportProblem target={{ itemId: ex.id, unitId: unit.id, answer }} />
    </section>
  );
}

/** Asks the learner's AI provider for a fuller explanation of this item. */
export function WhyButton({ ex, unit, answer }: { ex: Exercise; unit: CompiledUnit; answer: string }) {
  const ai = useAi('explain');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; text?: string }>({ status: 'idle' });
  if (ai.status === 'loading') return null;
  if (ai.status !== 'ready') return <p className="text-xs text-muted">{aiUnavailableMessage(ai)}</p>;

  const ask = async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'done', text: await explain(ai.provider, ex, answer, unit.level) });
    } catch (e) {
      setState({ status: 'error', text: errorMessage(e) });
    }
  };

  return (
    <div>
      {state.status !== 'done' && (
        <button type="button" className="btn-secondary" onClick={ask} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Asking…' : 'Why?'}
        </button>
      )}
      {state.text && (
        <p className={`mt-2 whitespace-pre-wrap rounded-xl bg-surface p-3 text-sm ${state.status === 'error' ? 'text-bad' : ''}`}>{state.text}</p>
      )}
    </div>
  );
}
