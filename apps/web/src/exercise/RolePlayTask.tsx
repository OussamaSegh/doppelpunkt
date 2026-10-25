import { useState } from 'react';
import type { CompiledUnit } from '@doppelpunkt/content-schema';
import { tutorSystemPrompt } from '@doppelpunkt/ai';
import { ChatPanel } from '../components/ChatPanel';
import { GermanText } from '../components/GermanText';
import { aiUnavailableMessage, useAi } from '../lib/ai';
import { useSettings } from '../lib/hooks';
import { recordAttempt } from '../lib/progress';
import type { ExerciseOf, ExerciseOutcome } from './types';

type Props = { ex: ExerciseOf<'roleplay'>; unit: CompiledUnit; record: boolean; onDone: (o: ExerciseOutcome) => void };

export function roleplayPrompt(base: string, ex: ExerciseOf<'roleplay'>): string {
  return [
    base,
    '',
    'ROLE-PLAY for this lesson. Stay in role; keep turns short and at the learner\'s level.',
    `Scenario: ${ex.scenario}`,
    `The learner should: ${ex.goals.map((g, i) => `${i + 1}. ${g}`).join(' ')}`,
    'Open the scene with your first line. When all goals are reached, end the scene and give two short tips in English.',
  ].join('\n');
}

export function RolePlayTask({ ex, unit, record, onDone }: Props) {
  const ai = useAi('roleplay');
  const settings = useSettings();
  const [phase, setPhase] = useState<'intro' | 'chat' | 'review' | 'done'>('intro');
  const [goals, setGoals] = useState<boolean[]>(() => ex.goals.map(() => false));

  const finish = async () => {
    const score = goals.filter(Boolean).length / goals.length;
    if (record) await recordAttempt(ex, unit, score);
    setPhase('done');
    onDone({ exerciseId: ex.id, score, correct: score >= 0.7 });
  };

  const system =
    settings && ai.status === 'ready'
      ? roleplayPrompt(tutorSystemPrompt(ex.tutor, { level: unit.level, unit, dialect: settings.dialect }), ex)
      : '';

  return (
    <div className="space-y-3">
      <p className="text-base">{ex.scenario}</p>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your goals</p>
        <ul className="list-disc pl-5 text-sm">
          {ex.goals.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </div>

      {phase === 'intro' && (
        <div className="flex flex-wrap gap-2">
          {ai.status === 'ready' && (
            <button type="button" className="btn-primary" onClick={() => setPhase('chat')}>
              Start conversation
            </button>
          )}
          <button type="button" className={ai.status === 'ready' ? 'btn-secondary' : 'btn-primary'} onClick={() => setPhase('review')}>
            {ai.status === 'ready' ? 'Practise without AI' : 'Practise with the model dialogue'}
          </button>
          {ai.status !== 'ready' && <p className="w-full text-xs text-muted">{aiUnavailableMessage(ai)}</p>}
        </div>
      )}

      {phase === 'chat' && ai.status === 'ready' && (
        <>
          <ChatPanel provider={ai.provider} system={system} opener="(Start the scene now.)" />
          <button type="button" className="btn-secondary" onClick={() => setPhase('review')}>
            End conversation
          </button>
        </>
      )}

      {(phase === 'review' || phase === 'done') && (
        <details className="rounded-xl bg-surface-2 p-3" open={phase === 'review' && ai.status !== 'ready'}>
          <summary className="cursor-pointer text-sm font-semibold">Model dialogue</summary>
          <div className="mt-2 space-y-1">
            {ex.model.split('\n').filter(Boolean).map((line, i) => (
              <GermanText key={i} text={line} variety={ex.variety} audio />
            ))}
          </div>
        </details>
      )}

      {phase === 'review' && (
        <fieldset className="card space-y-2">
          <legend className="px-1 text-sm font-semibold">Which goals did you reach?</legend>
          {ex.goals.map((g, i) => (
            <label key={i} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={goals[i] ?? false}
                onChange={(e) => setGoals(goals.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              {g}
            </label>
          ))}
          <button type="button" className="btn-primary" onClick={finish}>
            Save
          </button>
        </fieldset>
      )}
      {phase === 'done' && <p className="text-sm">{ex.explanation}</p>}
    </div>
  );
}
