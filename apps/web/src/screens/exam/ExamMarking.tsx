// After the last section: score the open tasks (writing, role-play, speaking) with AI when a key
// is unlocked, or by self-assessment against the task's checklist.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledUnit, Exercise, Level } from '@doppelpunkt/content-schema';
import { gradeWriting, type OpenWriting, type WritingFeedback } from '@doppelpunkt/ai';
import { AudioButton } from '../../components/AudioButton';
import { GermanText } from '../../components/GermanText';
import { SELF_RATINGS } from '../../components/SpeakCheck';
import { writingScore } from '../../exercise/WriteTask';
import { aiUnavailableMessage, errorMessage, useAi } from '../../lib/ai';
import type { ExamItemMethod } from '../../db';
import type { Take } from './ExamItems';

type OpenExercise = Extract<Exercise, { type: 'write' | 'roleplay' | 'speak' }>;

export type Mark = {
  method: ExamItemMethod;
  /** 0..1 for AI / self marks; absent when the engine grades a speaking transcript. */
  openScore?: number;
  transcript?: string;
  feedback?: WritingFeedback;
  selfCheck?: boolean[];
};

export const isOpenExercise = (ex: Exercise): ex is OpenExercise => ex.type === 'write' || ex.type === 'roleplay' || ex.type === 'speak';

/** The writing task AI and self-assessment use for a role-play: its goals are the checklist. */
export function asWriting(ex: Extract<Exercise, { type: 'write' | 'roleplay' }>): OpenWriting {
  if (ex.type === 'write') return ex;
  return {
    ...ex,
    type: 'write',
    task: `${ex.scenario}\nGoals: ${ex.goals.join('; ')}`,
    model: ex.model,
    checklist: ex.goals,
  };
}

/** Marks that need no decision: empty answers, and speaking with a recognised transcript. */
export function automaticMarks(items: OpenExercise[], texts: Record<string, string>, takes: Record<string, Take>): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  for (const ex of items) {
    if (ex.type === 'speak') {
      const take = takes[ex.id];
      if (take?.transcript.trim()) out[ex.id] = { method: 'auto', transcript: take.transcript.trim() };
      else if (!take?.audio) out[ex.id] = { method: 'unanswered', openScore: 0 };
    } else if (!(texts[ex.id] ?? '').trim()) {
      out[ex.id] = { method: 'unanswered', openScore: 0 };
    }
  }
  return out;
}

type Props = {
  items: OpenExercise[];
  points: Record<string, number>;
  unit: CompiledUnit;
  level: Level;
  texts: Record<string, string>;
  takes: Record<string, Take>;
  onDone: (marks: Record<string, Mark>) => void;
};

export function ExamMarking({ items, points, unit, level, texts, takes, onDone }: Props) {
  const initial = useMemo(() => automaticMarks(items, texts, takes), [items, texts, takes]);
  const [marks, setMarks] = useState<Record<string, Mark>>(initial);
  const pending = items.filter((ex) => !marks[ex.id]);
  const ai = useAi('writing');

  // Nothing to decide: go straight to the results (once).
  const sent = useRef(false);
  const done = (m: Record<string, Mark>) => {
    if (sent.current) return;
    sent.current = true;
    onDone(m);
  };
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (items.every((ex) => initial[ex.id])) doneRef.current(initial);
  }, [items, initial]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const set = (id: string, m: Mark) => setMarks((cur) => ({ ...cur, [id]: m }));

  return (
    <section className="space-y-4" aria-labelledby="marking-title">
      <h2 id="marking-title" ref={heading} tabIndex={-1} className="text-xl font-bold">
        Score your writing and speaking
      </h2>
      <p className="text-sm">
        {ai.status === 'ready'
          ? 'Your AI tutor can score each text against the task (this uses your key and costs a little), or you can score it yourself with the checklist.'
          : `Score each task yourself with its checklist.${ai.status === 'loading' ? '' : ` ${aiUnavailableMessage(ai)}`}`}
      </p>
      <ol className="space-y-4">
        {items.map((ex) => (
          <li key={ex.id}>
            <OpenMark
              ex={ex}
              points={points[ex.id] ?? 1}
              unit={unit}
              level={level}
              text={texts[ex.id] ?? ''}
              take={takes[ex.id]}
              mark={marks[ex.id]}
              onMark={(m) => set(ex.id, m)}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending.length > 0} onClick={() => done(marks)}>
          See my results
        </button>
        {pending.length > 0 && (
          <p className="text-sm text-muted" aria-live="polite">
            {pending.length} task{pending.length === 1 ? '' : 's'} still to score.
          </p>
        )}
      </div>
    </section>
  );
}

function OpenMark(props: {
  ex: OpenExercise;
  points: number;
  unit: CompiledUnit;
  level: Level;
  text: string;
  take?: Take;
  mark?: Mark;
  onMark: (m: Mark) => void;
}) {
  const { ex, points, mark } = props;
  return (
    <article className="card space-y-3" aria-labelledby={`mark-${ex.id}`}>
      <h3 id={`mark-${ex.id}`} className="font-semibold">
        {ex.prompt} <span className="text-sm font-normal text-muted">({points} point{points === 1 ? '' : 's'})</span>
      </h3>
      {mark ? (
        <MarkSummary mark={mark} points={points} />
      ) : ex.type === 'speak' ? (
        <SpeakMark ex={ex} take={props.take} onMark={props.onMark} />
      ) : (
        <WriteMark ex={ex} level={props.level} text={props.text} onMark={props.onMark} />
      )}
    </article>
  );
}

function MarkSummary({ mark, points }: { mark: Mark; points: number }) {
  const how: Record<ExamItemMethod, string> = {
    auto: 'scored from what the speech recognition heard',
    ai: 'scored by your AI tutor',
    self: 'scored by you',
    unanswered: 'not answered',
  };
  return (
    <p className="text-sm" role="status">
      {mark.openScore !== undefined ? `${Math.round(mark.openScore * points * 10) / 10} of ${points} points, ` : ''}
      {how[mark.method]}.
    </p>
  );
}

function WriteMark({ ex, level, text, onMark }: { ex: Extract<Exercise, { type: 'write' | 'roleplay' }>; level: Level; text: string; onMark: (m: Mark) => void }) {
  const ai = useAi('writing');
  const task = asWriting(ex);
  const [chosen, setMode] = useState<'choose' | 'grading' | 'self'>();
  // Until the learner picks, offer AI when a key is unlocked (the key state loads asynchronously).
  const mode = chosen ?? (ai.status === 'ready' ? 'choose' : 'self');
  const [checks, setChecks] = useState<boolean[]>(() => task.checklist.map(() => false));
  const [error, setError] = useState<string>();

  const viaAi = async () => {
    if (ai.status !== 'ready') return;
    setMode('grading');
    setError(undefined);
    try {
      const fb = await gradeWriting(ai.provider, task, text, level);
      onMark({ method: 'ai', openScore: writingScore(fb.scores), feedback: fb });
    } catch (e) {
      setError(`${errorMessage(e)} You can score it yourself instead.`);
      setMode('self');
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your answer</p>
        <p lang="de" className="whitespace-pre-wrap">{text}</p>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {mode === 'choose' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => void viaAi()}>
            Score with AI
          </button>
          <button type="button" className="btn-secondary" onClick={() => setMode('self')}>
            Score it myself
          </button>
        </div>
      )}
      {mode === 'grading' && <p role="status">Your tutor is reading your text…</p>}
      {mode === 'self' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Tick what your text does</legend>
          {task.checklist.map((c, i) => (
            <label key={i} className="flex min-h-6 items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0"
                checked={checks[i] ?? false}
                onChange={(e) => setChecks(checks.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              {c}
            </label>
          ))}
          <details className="rounded-xl bg-surface-2 p-3">
            <summary className="cursor-pointer text-sm font-semibold">Model answer</summary>
            <GermanText text={task.model} variety={ex.variety} className="mt-2 whitespace-pre-wrap" />
          </details>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onMark({ method: 'self', openScore: checks.filter(Boolean).length / Math.max(1, checks.length), selfCheck: checks })}
          >
            Save my score
          </button>
        </fieldset>
      )}
    </div>
  );
}

function SpeakMark({ ex, take, onMark }: { ex: Extract<Exercise, { type: 'speak' }>; take?: Take; onMark: (m: Mark) => void }) {
  const ai = useAi('other');
  const transcriber = ai.status === 'ready' && ai.provider.transcribe ? ai : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [url] = useState(() => (take?.audio ? URL.createObjectURL(take.audio) : undefined));
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const transcribe = async () => {
    if (!transcriber?.provider.transcribe || !take?.audio) return;
    setBusy(true);
    setError(undefined);
    try {
      const text = (await transcriber.provider.transcribe(take.audio, ex.variety === 'gsw-zh' || ex.variety === 'gsw-be' ? 'gsw' : 'de')).trim();
      if (!text) setError('The transcription came back empty. Rate yourself instead.');
      else onMark({ method: 'auto', transcript: text });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <GermanText text={ex.target} variety={ex.variety} audio className="font-medium" />
      {url && (
        <audio controls src={url} className="h-10 w-full" aria-label="Your recording">
          <track kind="captions" />
        </audio>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {transcriber && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void transcribe()}>
          {busy ? 'Transcribing…' : 'Transcribe and score it'}
        </button>
      )}
      <div role="group" aria-label="Rate yourself" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Compare with the model and rate yourself:</span>
        {ex.variety !== 'gsw-zh' && ex.variety !== 'gsw-be' && (
          <AudioButton text={ex.target} variety={ex.variety} label="Model" className="border border-line" />
        )}
        {SELF_RATINGS.map((r) => (
          <button key={r.label} type="button" className="btn-secondary" onClick={() => onMark({ method: 'self', openScore: r.score })}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
