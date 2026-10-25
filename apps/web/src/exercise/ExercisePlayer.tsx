import { useCallback, useRef, useState, type ComponentType } from 'react';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { grade, type Answer, type GradeResult } from '@doppelpunkt/engine';
import { VarietyTag } from '../components/VarietyTag';
import { recordAttempt } from '../lib/progress';
import { errorMessage } from '../lib/ai';
import { haptic, resultTone, toneOfScore } from '../lib/feedback';
import { useSettings } from '../lib/hooks';
import { useCardKeys } from '../lib/keys';
import { Feedback } from './Feedback';
import { DictationInput, GapInput, MatchInput, McqInput, OrderInput, TransformInput, TranslateInput } from './inputs';
import { RolePlayTask } from './RolePlayTask';
import { SpeakTask } from './SpeakTask';
import { WriteTask } from './WriteTask';
import { answerText, type ExerciseOutcome, type InputProps } from './types';

export type { ExerciseOutcome } from './types';

type ClosedType = 'mcq' | 'gap' | 'order' | 'match' | 'dictation' | 'translate' | 'transform';
type ClosedExercise = Extract<Exercise, { type: ClosedType }>;

const INPUTS: { [K in ClosedType]: ComponentType<InputProps<K>> } = {
  mcq: McqInput,
  gap: GapInput,
  order: OrderInput,
  match: MatchInput,
  dictation: DictationInput,
  translate: TranslateInput,
  transform: TransformInput,
};

const TYPE_LABEL: Record<Exercise['type'], string> = {
  mcq: 'Multiple choice',
  gap: 'Fill the gaps',
  order: 'Word order',
  match: 'Match',
  dictation: 'Dictation',
  translate: 'Translate',
  transform: 'Transform',
  speak: 'Speak',
  write: 'Writing',
  roleplay: 'Role-play',
};

type Props = {
  exercise: Exercise;
  unit: CompiledUnit;
  /** Save attempts to the progress store (off for the placement test). */
  record?: boolean;
  /** Hide solutions after checking (placement test). */
  showFeedback?: boolean;
  onDone?: (outcome: ExerciseOutcome) => void;
  /** Called on Enter once the item is answered (go to the next item). */
  onNext?: () => void;
};

/**
 * Renders any exercise type; closed types are graded locally by the engine.
 * Keyboard: Enter checks, then (with `onNext`) moves on; 1–9 pick a multiple-choice option.
 */
export function ExercisePlayer({ exercise, unit, record = true, showFeedback = true, onDone, onNext }: Props) {
  const settings = useSettings();
  const ref = useRef<HTMLElement>(null);
  const [finished, setFinished] = useState(false);
  const hapticsOn = settings?.haptics ?? true;
  const done = useCallback(
    (o: ExerciseOutcome) => {
      setFinished(true);
      if (showFeedback) haptic(o.tone ?? toneOfScore(o.score, o.correct), hapticsOn);
      onDone?.(o);
    },
    [onDone, showFeedback, hapticsOn],
  );
  useCardKeys(ref, (e) => {
    if (e.key !== 'Enter' || !finished || !onNext) return;
    onNext();
    return true;
  });
  return (
    <article ref={ref} className="card" aria-labelledby={`ex-${exercise.id}-prompt`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{TYPE_LABEL[exercise.type]}</span>
        <VarietyTag variety={exercise.variety} />
      </header>
      <h3 id={`ex-${exercise.id}-prompt`} className="mb-4 text-base font-semibold">
        {exercise.prompt}
      </h3>
      <Body key={exercise.id} exercise={exercise} unit={unit} record={record} showFeedback={showFeedback} onDone={done} />
    </article>
  );
}

type BodyProps = Required<Pick<Props, 'exercise' | 'unit' | 'record' | 'showFeedback'>> & { onDone: (o: ExerciseOutcome) => void };

function Body({ exercise, unit, record, showFeedback, onDone }: BodyProps) {
  switch (exercise.type) {
    case 'write':
      return <WriteTask ex={exercise} unit={unit} record={record} onDone={onDone} />;
    case 'roleplay':
      return <RolePlayTask ex={exercise} unit={unit} record={record} onDone={onDone} />;
    case 'speak':
      return <SpeakTask ex={exercise} unit={unit} record={record} onDone={onDone} />;
    default:
      return <ClosedPlayer ex={exercise} unit={unit} record={record} showFeedback={showFeedback} onDone={onDone} />;
  }
}

function ClosedPlayer({
  ex,
  unit,
  record,
  showFeedback,
  onDone,
}: {
  ex: ClosedExercise;
  unit: CompiledUnit;
  record: boolean;
  showFeedback: boolean;
  onDone: (o: ExerciseOutcome) => void;
}) {
  const [answer, setAnswer] = useState<Answer>();
  const [result, setResult] = useState<GradeResult>();
  const [error, setError] = useState<string>();
  const Input = INPUTS[ex.type] as ComponentType<InputProps<ClosedType>>;
  const form = useRef<HTMLFormElement>(null);

  const check = async () => {
    if (answer === undefined || result) return;
    let r: GradeResult;
    try {
      r = grade(ex, answer);
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    setResult(r);
    onDone({ exerciseId: ex.id, score: r.score, correct: r.correct, tone: resultTone(r) });
    if (record) await recordAttempt(ex, unit, r.score, r.correct ? undefined : ex.grammar);
  };

  // Enter on an option button (or with nothing focused) checks; Enter in a text field submits the form.
  useCardKeys(form, (e) => {
    if (e.key !== 'Enter' || result || answer === undefined) return;
    void check();
    return true;
  });

  return (
    <form
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void check();
      }}
    >
      <Input ex={ex} unit={unit} disabled={!!result} onChange={setAnswer} />
      {!result && (
        <button type="submit" className="btn-primary mt-4 w-full sm:w-auto" disabled={answer === undefined}>
          Check
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-bad">{error}</p>}
      {result && showFeedback && answer !== undefined && <Feedback ex={ex} unit={unit} result={result} answer={answerText(ex, answer)} />}
      {result && !showFeedback && <p className="mt-3 text-sm text-muted" role="status">Answer saved.</p>}
    </form>
  );
}
