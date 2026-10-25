// Exam items: the normal answer inputs, but no Check button and no feedback until the end.
import { useCallback, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { CompiledUnit, ExamSection, Exercise } from '@doppelpunkt/content-schema';
import type { Answer } from '@doppelpunkt/engine';
import { AudioButton } from '../../components/AudioButton';
import { GermanText } from '../../components/GermanText';
import { Markdown } from '../../components/Markdown';
import { Recorder, type RecorderResult } from '../../components/Recorder';
import { VarietyTag } from '../../components/VarietyTag';
import { audioUrl } from '../../content';
import { INPUTS, TYPE_LABEL, type ClosedType } from '../../exercise/ExercisePlayer';
import type { InputProps } from '../../exercise/types';
import { UmlautBar } from '../../exercise/UmlautBar';
import { stimulusLang, stimulusPlayable } from '../../lib/exam';
import { VARIETY_META } from '../../lib/varieties';

export type Take = { audio?: Blob; transcript: string };

const countWords = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The section's shared text or recording, shown above its items. */
export function Stimulus({ section, unit }: { section: ExamSection; unit: CompiledUnit }) {
  const st = section.stimulus;
  if (!st) return null;
  const url = st.audio ? audioUrl(unit, st.audio) : undefined;
  const listening = section.skill === 'listening' && stimulusPlayable(st);
  return (
    <section className="card space-y-3" aria-labelledby={`stim-${section.id}`}>
      <h3 id={`stim-${section.id}`} className="font-semibold">
        {st.title ?? (listening ? 'Recording' : 'Text')}
      </h3>
      {listening ? (
        <>
          <p className="text-sm text-muted">
            Listen as often as you like (in the real exam you hear most recordings twice). The transcript is in the review after the exam.
            {!url && ' There is no studio recording yet, so a synthetic voice reads it.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <VarietyTag variety={st.variety} />
            <AudioButton text={st.text} variety={st.variety} url={url} label="Play the recording" className="border border-line" />
            <AudioButton text={st.text} variety={st.variety} url={url} rate={0.75} label="Slower" className="border border-line" />
          </div>
        </>
      ) : (
        <div lang={stimulusLang(st)} className="flex items-start gap-2">
          <VarietyTag variety={st.variety} className="mt-1" />
          <div className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed">{st.text}</div>
          {section.skill === 'listening' && <span className="sr-only">(No recording: read the transcript instead.)</span>}
        </div>
      )}
    </section>
  );
}

type ItemProps = { ex: Exercise; unit: CompiledUnit; n: number; points: number; children: ReactNode };

/** Card shell shared by every exam item: number, points, prompt. */
function ItemCard({ ex, n, points, children }: ItemProps) {
  return (
    <article className="card" aria-labelledby={`exam-${ex.id}-prompt`} data-exercise-id={ex.id}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {n}. {TYPE_LABEL[ex.type]} · {points} point{points === 1 ? '' : 's'}
        </span>
        <VarietyTag variety={ex.variety} />
      </header>
      <h3 id={`exam-${ex.id}-prompt`} className="mb-3 text-base font-semibold">
        <span className="sr-only">Item {n}: </span>
        {ex.prompt}
      </h3>
      {children}
    </article>
  );
}

export function ExamItem(props: {
  ex: Exercise;
  unit: CompiledUnit;
  n: number;
  points: number;
  onAnswer: (id: string, a: Answer | undefined) => void;
  onText: (id: string, text: string) => void;
  onTake: (id: string, take: Take) => void;
  text?: string;
}) {
  const { ex, unit, n, points } = props;
  let body;
  switch (ex.type) {
    case 'write':
    case 'roleplay':
      body = <TextItem ex={ex} value={props.text ?? ''} onChange={(t) => props.onText(ex.id, t)} />;
      break;
    case 'speak':
      body = <SpeakItem ex={ex} onTake={(t) => props.onTake(ex.id, t)} />;
      break;
    default:
      body = <ClosedItem ex={ex} unit={unit} onAnswer={props.onAnswer} />;
  }
  return (
    <ItemCard ex={ex} unit={unit} n={n} points={points}>
      {body}
    </ItemCard>
  );
}

function ClosedItem({ ex, unit, onAnswer }: { ex: Extract<Exercise, { type: ClosedType }>; unit: CompiledUnit; onAnswer: (id: string, a: Answer | undefined) => void }) {
  const Input = INPUTS[ex.type] as ComponentType<InputProps<ClosedType>>;
  const onChange = useCallback((a: Answer | undefined) => onAnswer(ex.id, a), [ex.id, onAnswer]);
  const url = ex.audio && ex.type !== 'dictation' ? audioUrl(unit, ex.audio) : undefined;
  return (
    <div className="space-y-3">
      {url && (
        <AudioButton
          text={ex.type === 'mcq' ? (ex.question ?? '') : ''}
          variety={ex.variety}
          url={url}
          label="Play"
          className="border border-line"
        />
      )}
      <Input ex={ex} unit={unit} disabled={false} onChange={onChange} />
    </div>
  );
}

function TextItem({ ex, value, onChange }: { ex: Extract<Exercise, { type: 'write' | 'roleplay' }>; value: string; onChange: (t: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const id = `exam-text-${ex.id}`;
  const minWords = ex.type === 'write' ? ex.minWords : undefined;
  const words = countWords(value);
  return (
    <div className="space-y-2">
      {ex.type === 'write' ? (
        <p>{ex.task}</p>
      ) : (
        <>
          <p>{ex.scenario}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">What you need to do</p>
          <ul className="list-disc pl-5 text-sm">
            {ex.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">Write what you would say, as you would say it.</p>
        </>
      )}
      <label htmlFor={id} className="label">
        Your answer{minWords ? ` (at least ${minWords} words)` : ''}
      </label>
      <textarea
        ref={area}
        id={id}
        rows={6}
        lang={VARIETY_META[ex.variety].lang}
        className="input"
        value={value}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <UmlautBar target={() => area.current} onInsert={onChange} />
      <p className={`text-xs ${minWords && words < minWords ? 'text-bad' : 'text-muted'}`}>
        {words} word{words === 1 ? '' : 's'}
      </p>
    </div>
  );
}

function SpeakItem({ ex, onTake }: { ex: Extract<Exercise, { type: 'speak' }>; onTake: (t: Take) => void }) {
  const [saved, setSaved] = useState(false);
  const onRecorded = useCallback(
    (r: RecorderResult) => {
      onTake({ audio: r.audio, transcript: r.transcript });
      setSaved(true);
    },
    [onTake],
  );
  return (
    <div className="space-y-3">
      <GermanText text={ex.target} variety={ex.variety} className="text-lg font-medium" />
      <p className="text-sm text-muted">Record your answer. It is scored after the last section (by speech recognition, AI transcription, or by you).</p>
      <Recorder text={ex.target} variety={ex.variety} maxSeconds={60} showNative={false} onRecorded={onRecorded} />
      {saved && (
        <p className="text-sm text-muted" role="status">
          Recording saved. You can record again until the section ends.
        </p>
      )}
    </div>
  );
}

/** The section's instructions (English, with the German rubric line). */
export function Instructions({ section }: { section: ExamSection }) {
  return <Markdown text={section.instructions} className="text-sm" />;
}
