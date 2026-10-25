import { useState } from 'react';
import type { CompiledUnit } from '@doppelpunkt/content-schema';
import { AudioButton } from '../components/AudioButton';
import { GermanText } from '../components/GermanText';
import { SpeakCheck, type SpeakOutcome } from '../components/SpeakCheck';
import { audioUrl } from '../content';
import { nativeSource } from '../lib/speech';
import { recordAttempt } from '../lib/progress';
import { Feedback } from './Feedback';
import type { ExerciseOf, ExerciseOutcome } from './types';

type Props = { ex: ExerciseOf<'speak'>; unit: CompiledUnit; record: boolean; onDone: (o: ExerciseOutcome) => void };

export function SpeakTask({ ex, unit, record, onDone }: Props) {
  const [outcome, setOutcome] = useState<SpeakOutcome>();
  const [shadowing, setShadowing] = useState(false);
  const url = ex.audio ? audioUrl(unit, ex.audio) : undefined;
  const native = nativeSource(ex.variety, url);

  const graded = async (o: SpeakOutcome) => {
    setOutcome(o);
    if (record) await recordAttempt(ex, unit, o.score);
    onDone({ exerciseId: ex.id, score: o.score, correct: o.correct });
  };

  return (
    <div className="space-y-3">
      <GermanText text={ex.target} variety={ex.variety} audio={native === 'none' ? false : (url ?? true)} className="text-xl font-medium" />
      <div className="flex flex-wrap items-center gap-2">
        {native !== 'none' ? (
          <AudioButton text={ex.target} variety={ex.variety} url={url} rate={0.75} label="Slow" className="border border-line" />
        ) : (
          <span className="text-xs text-muted">No recording yet</span>
        )}
        {!outcome && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="h-5 w-5" checked={shadowing} onChange={(e) => setShadowing(e.target.checked)} />
            Shadowing mode
          </label>
        )}
      </div>
      <SpeakCheck
        ex={ex}
        nativeUrl={url}
        shadowing={shadowing}
        onGraded={graded}
        renderResult={(result, transcript) => <Feedback ex={ex} unit={unit} result={result} answer={transcript} />}
      />
      {outcome && outcome.path === 'self' && <p className="text-sm">{ex.explanation}</p>}
    </div>
  );
}
