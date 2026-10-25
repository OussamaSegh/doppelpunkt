import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import type { Exercise, Variety } from '@doppelpunkt/content-schema';
import { grade, type GradeResult, type PronunciationHint } from '@doppelpunkt/engine';
import type { ProviderId } from '@doppelpunkt/ai';
import { errorMessage, useAi } from '../lib/ai';
import { canRecognize, recognitionLang } from '../lib/speech';
import { UmlautBar } from '../exercise/UmlautBar';
import { DiffView } from './DiffView';
import { Recorder, type RecorderResult } from './Recorder';

/** How the learner's speech was turned into text (shown so the score can be trusted). */
export type RecognitionPath = 'browser' | 'ai' | 'typed' | 'self';

export const SELF_RATINGS = [
  { label: 'Needs work', score: 0.3 },
  { label: 'Okay', score: 0.7 },
  { label: 'Sounded right', score: 1 },
] as const;

const PROVIDER_NAME: Partial<Record<ProviderId, string>> = { openai: 'OpenAI', gemini: 'Gemini' };

const isGsw = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

export type SpeakOutcome = { score: number; correct: boolean; path: RecognitionPath; result?: GradeResult; transcript: string };

type Props = {
  /** The speak exercise to grade against (drills build one from their word or sentence). */
  ex: Extract<Exercise, { type: 'speak' }>;
  nativeUrl?: string;
  shadowing?: boolean;
  /** Called once per graded attempt. */
  onGraded: (o: SpeakOutcome) => void | Promise<void>;
  /** Custom result view (the unit player uses its Feedback panel); defaults to the word diff. */
  renderResult?: (result: GradeResult, transcript: string) => ReactNode;
  /** Allow another attempt after grading (drills); the unit player moves on instead. */
  retry?: boolean;
  ratings?: ReadonlyArray<{ label: string; score: number }>;
};

/**
 * Record → recognise → grade, for one sentence. Recognition: browser speech API where available,
 * otherwise transcription by the learner's OpenAI or Gemini key, otherwise self-rating.
 */
export function SpeakCheck({ ex, nativeUrl, shadowing = false, onGraded, renderResult, retry = false, ratings = SELF_RATINGS }: Props) {
  const ai = useAi('other');
  const fieldId = useId();
  const heardRef = useRef<HTMLInputElement>(null);
  const [transcript, setTranscript] = useState('');
  const [path, setPath] = useState<RecognitionPath>();
  const [edited, setEdited] = useState(false);
  const [audio, setAudio] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<GradeResult>();
  const [selfRated, setSelfRated] = useState<string>();
  const [done, setDone] = useState(false);

  const transcriber = ai.status === 'ready' && ai.provider.transcribe ? ai : undefined;
  const providerName = transcriber ? (PROVIDER_NAME[transcriber.providerId] ?? transcriber.providerId) : '';
  const browserCan = canRecognize();

  const reset = () => {
    setResult(undefined);
    setSelfRated(undefined);
    setDone(false);
    setError(undefined);
  };

  const onStart = useCallback(() => {
    setTranscript('');
    setPath(undefined);
    setEdited(false);
    setAudio(undefined);
    setResult(undefined);
    setSelfRated(undefined);
    setDone(false);
    setError(undefined);
  }, []);

  const onInterim = useCallback((t: string) => {
    setTranscript(t);
    if (t) setPath('browser');
  }, []);

  const onRecorded = useCallback((r: RecorderResult) => {
    setAudio(r.audio);
    if (r.transcript) {
      setTranscript(r.transcript);
      setPath('browser');
    }
  }, []);

  const transcribe = async () => {
    if (!transcriber?.provider.transcribe || !audio) return;
    setBusy(true);
    setError(undefined);
    try {
      const text = await transcriber.provider.transcribe(audio, isGsw(ex.variety) ? 'gsw' : 'de');
      setTranscript(text.trim());
      setPath('ai');
      setEdited(false);
      if (!text.trim()) setError('The transcription came back empty. Try again closer to the microphone.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    const r = grade(ex, transcript);
    setResult(r);
    setDone(true);
    await onGraded({ score: r.score, correct: r.correct, path: path ?? 'typed', result: r, transcript });
  };

  const rate = async (label: string, score: number) => {
    setSelfRated(label);
    setPath('self');
    setDone(true);
    await onGraded({ score, correct: score >= 0.7, path: 'self', transcript });
  };

  const pathLabel =
    path === 'browser'
      ? `Recognised by your browser (${recognitionLang(ex.variety)})${edited ? ', corrected by you' : ''}`
      : path === 'ai'
        ? `Transcribed by ${providerName || 'AI'}${edited ? ', corrected by you' : ''}`
        : path === 'self'
          ? 'Self-rated'
          : path === 'typed'
            ? 'Typed by you'
            : undefined;

  const showField = !done && (browserCan || transcript || path === 'ai' || (audio && !!transcriber));
  const canTranscribe = !done && audio && transcriber && path !== 'ai' && (!transcript || isGsw(ex.variety));

  return (
    <div className="space-y-3">
      {!done && (
        <Recorder
          text={ex.target}
          variety={ex.variety}
          nativeUrl={nativeUrl}
          shadowing={shadowing}
          onStart={onStart}
          onInterim={onInterim}
          onRecorded={onRecorded}
        />
      )}

      {!done && (
        <p className="text-xs text-muted">
          {browserCan
            ? isGsw(ex.variety)
              ? `Speech recognition here only knows Standard German (${recognitionLang(ex.variety)}), so Swiss German comes out as Hochdeutsch. Correct the text${transcriber ? `, use ${providerName}` : ''} or rate yourself.`
              : `Speech recognition: your browser (${recognitionLang(ex.variety)}).`
            : transcriber
              ? `Your browser can't recognise speech; after recording, ${providerName} can transcribe it with your key.`
              : "Your browser can't recognise speech. Listen to your recording next to the native one and rate yourself (or add an OpenAI or Gemini key in Settings for transcription)."}
        </p>
      )}

      {showField && (
        <div>
          <label htmlFor={fieldId} className="label">
            What we heard (you can correct it)
          </label>
          <input
            ref={heardRef}
            id={fieldId}
            className="input"
            lang="de"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={transcript}
            onChange={(e) => {
              setTranscript(e.target.value);
              setEdited(true);
              if (!path) setPath('typed');
            }}
          />
          <UmlautBar
            target={() => heardRef.current}
            onInsert={(v) => {
              setTranscript(v);
              setEdited(true);
            }}
          />
        </div>
      )}
      {pathLabel && (
        <p role="status" className="text-xs font-medium text-muted" data-path={path}>
          {pathLabel}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}

      {!done && (
        <div className="flex flex-wrap gap-2">
          {transcript.trim() && (
            <button type="button" className="btn-primary" onClick={() => void check()}>
              Check
            </button>
          )}
          {canTranscribe && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void transcribe()}>
              {busy ? 'Transcribing…' : `Transcribe with ${providerName}`}
            </button>
          )}
        </div>
      )}
      {!done && (
        <div role="group" aria-label="Rate yourself" className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Or rate yourself:</span>
          {ratings.map((r) => (
            <button key={r.label} type="button" className="btn-secondary" onClick={() => void rate(r.label, r.score)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {result && (renderResult ? renderResult(result, transcript) : <SpeakResult result={result} />)}
      {result?.hints && result.hints.length > 0 && <PronunciationHints hints={result.hints} />}
      {selfRated && !result && <p className="text-sm">You rated this: {selfRated}.</p>}
      {done && retry && (
        <button type="button" className="btn-ghost px-0" onClick={reset}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Compact speaking result: score, word-by-word diff and hints. */
export function SpeakResult({ result }: { result: GradeResult }) {
  const pct = Math.round(result.score * 100);
  return (
    <section
      aria-label="Result"
      aria-live="polite"
      className={`space-y-2 rounded-xl border p-3 ${result.correct ? 'border-ok/40 bg-ok-soft' : 'border-bad/40 bg-bad-soft'}`}
    >
      <p className={`font-semibold ${result.correct ? 'text-ok' : 'text-bad'}`}>
        {result.correct ? 'Richtig!' : 'Not quite'} — {pct}% of the words recognised
      </p>
      {result.diff && result.diff.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Word by word</p>
          <DiffView tokens={result.diff} />
        </div>
      )}
      {result.feedback.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {result.feedback.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Sounds the recogniser suggests you work on (from the engine's speaking grader). */
export function PronunciationHints({ hints }: { hints: PronunciationHint[] }) {
  return (
    <section aria-label="Pronunciation tips" className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft p-3">
      <p className="text-sm font-semibold">Sounds to work on</p>
      <ul className="space-y-1.5 text-sm">
        {hints.map((h) => (
          <li key={h.id}>
            <span className="font-semibold">{h.label}:</span> {h.tip}
            {h.words.length > 0 && (
              <span className="block text-xs text-muted">
                {h.words.map((w) => (
                  <span key={`${w.expected}-${w.heard}`} className="mr-2">
                    <span lang="de">{w.expected}</span> → heard <span lang="de">“{w.heard}”</span>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
