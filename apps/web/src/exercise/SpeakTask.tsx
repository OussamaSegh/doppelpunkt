import { useEffect, useRef, useState } from 'react';
import type { CompiledUnit } from '@doppelpunkt/content-schema';
import { grade, type GradeResult } from '@doppelpunkt/engine';
import { AudioButton } from '../components/AudioButton';
import { GermanText } from '../components/GermanText';
import { audioUrl } from '../content';
import { errorMessage, useAi } from '../lib/ai';
import { recordAttempt } from '../lib/progress';
import { canRecognize, canRecord, startRecording, type Recording } from '../lib/speech';
import { Feedback } from './Feedback';
import type { ExerciseOf, ExerciseOutcome } from './types';
import { UmlautBar } from './UmlautBar';

type Props = { ex: ExerciseOf<'speak'>; unit: CompiledUnit; record: boolean; onDone: (o: ExerciseOutcome) => void };

const SELF_RATINGS = [
  { label: 'Needs work', score: 0.3 },
  { label: 'Okay', score: 0.7 },
  { label: 'Sounded right', score: 1 },
];

export function SpeakTask({ ex, unit, record, onDone }: Props) {
  const ai = useAi('other');
  const [rec, setRec] = useState<Recording>();
  const [audio, setAudio] = useState<Blob>();
  const [playback, setPlayback] = useState<string>();
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<GradeResult>();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const recRef = useRef<Recording | undefined>(undefined);
  const heardRef = useRef<HTMLInputElement>(null);
  recRef.current = rec;

  useEffect(() => () => recRef.current?.cancel(), []);
  useEffect(() => () => (playback ? URL.revokeObjectURL(playback) : undefined), [playback]);

  const canMic = canRecord() || canRecognize();
  const url = ex.audio ? audioUrl(unit, ex.audio) : undefined;

  const start = async () => {
    setError(undefined);
    try {
      setRec(await startRecording(ex.variety, setTranscript));
    } catch (e) {
      setError(`Microphone unavailable: ${errorMessage(e)}`);
    }
  };

  const stop = async () => {
    if (!rec) return;
    const r = await rec.stop();
    setRec(undefined);
    setAudio(r.audio);
    if (r.audio) setPlayback(URL.createObjectURL(r.audio));
    if (r.transcript) setTranscript(r.transcript);
  };

  const transcribeWithAi = async () => {
    if (ai.status !== 'ready' || !audio || !ai.provider.transcribe) return;
    setBusy(true);
    try {
      setTranscript(await ai.provider.transcribe(audio, ex.variety.startsWith('gsw') ? 'gsw' : 'de'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (score: number, correct: boolean) => {
    if (record) await recordAttempt(ex, unit, score);
    setDone(true);
    onDone({ exerciseId: ex.id, score, correct });
  };

  const check = async () => {
    const r = grade(ex, transcript);
    setResult(r);
    await finish(r.score, r.correct);
  };

  return (
    <div className="space-y-3">
      <GermanText text={ex.target} variety={ex.variety} audio={url ?? true} className="text-xl font-medium" />
      <div className="flex flex-wrap items-center gap-2">
        <AudioButton text={ex.target} variety={ex.variety} url={url} rate={0.75} label="Slow" className="border border-line" />
        {canMic && !done && (
          rec ? (
            <button type="button" className="btn-primary bg-swiss" onClick={stop}>
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> Stop recording
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={start}>
              Record
            </button>
          )
        )}
      </div>
      {!canMic && <p className="text-sm text-muted">Recording isn't available in this browser. Read the sentence aloud, then rate yourself.</p>}
      {canMic && !canRecognize() && <p className="text-xs text-muted">This browser can't recognise speech; listen to your recording and compare.</p>}
      {playback && (
        <audio controls src={playback} className="w-full" aria-label="Your recording">
          <track kind="captions" />
        </audio>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {!done && (canRecognize() || transcript) && (
        <div>
          <label htmlFor={`heard-${ex.id}`} className="label">
            What we heard (you can correct it)
          </label>
          <input
            ref={heardRef}
            id={`heard-${ex.id}`}
            className="input"
            lang="de"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <UmlautBar target={() => heardRef.current} onInsert={setTranscript} />
        </div>
      )}

      {!done && (
        <div className="flex flex-wrap gap-2">
          {transcript.trim() && (
            <button type="button" className="btn-primary" onClick={check}>
              Check
            </button>
          )}
          {audio && !transcript && ai.status === 'ready' && ai.provider.transcribe && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={transcribeWithAi}>
              {busy ? 'Transcribing…' : 'Transcribe with AI'}
            </button>
          )}
          {SELF_RATINGS.map((r) => (
            <button key={r.label} type="button" className="btn-secondary" onClick={() => finish(r.score, r.score >= 0.7)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      {result && <Feedback ex={ex} unit={unit} result={result} answer={transcript} />}
      {done && !result && <p className="text-sm">{ex.explanation}</p>}
    </div>
  );
}
