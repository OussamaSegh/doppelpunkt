import { useCallback, useEffect, useRef, useState } from 'react';
import type { Variety } from '@doppelpunkt/content-schema';
import {
  canRecognize,
  canRecord,
  micErrorKind,
  micFixSteps,
  micPermission,
  nativeSource,
  playNative,
  startRecording,
  type MicErrorKind,
  type MicState,
  type Recording,
} from '../lib/speech';
import { LevelMeter } from './LevelMeter';

export const SPEEDS = [0.75, 1, 1.25] as const;
export type Speed = (typeof SPEEDS)[number];

export type RecorderResult = {
  audio?: Blob;
  /** Text from browser speech recognition ('' when it did not run or heard nothing). */
  transcript: string;
  /** true when browser speech recognition was listening. */
  recognized: boolean;
};

type Props = {
  text: string;
  variety: Variety;
  /** Recording of a native speaker, if the content has one. */
  nativeUrl?: string;
  /** Hard stop after this many seconds (default: from the length of the text). */
  maxSeconds?: number;
  /** Show the shadowing controls: speed, "listen then speak" and loop. */
  shadowing?: boolean;
  /** Use browser speech recognition while recording (default true). */
  recognize?: boolean;
  onStart?: () => void;
  onInterim?: (text: string) => void;
  onRecorded?: (r: RecorderResult) => void;
};

/** Seconds a learner needs for a sentence: generous, but short enough that a forgotten recording stops. */
export function defaultMaxSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(30, Math.max(6, Math.ceil(3 + words * 1.2)));
}

const ERROR_TEXT: Record<MicErrorKind, string> = {
  denied: 'Microphone access is blocked for this site.',
  'no-device': 'No microphone was found. Plug one in or check your headset, then try again.',
  busy: 'The microphone is in use by another app (a call, another tab). Close it and try again.',
  insecure: 'The microphone only works on a secure (https) page.',
  unsupported: "Recording isn't supported in this browser.",
  other: 'The microphone could not be started.',
};

const fmt = (ms: number) => `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}`;

/**
 * Records the learner (MediaRecorder + live waveform), with a hard maximum length, re-record and
 * playback of "you" next to "native". Optional shadowing: play the native model at 0.75×–1.25×,
 * then record automatically, and loop the line.
 */
export function Recorder({ text, variety, nativeUrl, maxSeconds, shadowing = false, recognize = true, onStart, onInterim, onRecorded }: Props) {
  const max = (maxSeconds ?? defaultMaxSeconds(text)) * 1000;
  const supported = canRecord() || canRecognize();
  const native = nativeSource(variety, nativeUrl);

  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'playing-native'>('idle');
  const [rec, setRec] = useState<Recording>();
  const [elapsed, setElapsed] = useState(0);
  const [playback, setPlayback] = useState<string>();
  const [hasTake, setHasTake] = useState(false);
  const [error, setError] = useState<MicErrorKind>();
  const [permission, setPermission] = useState<MicState>('unknown');
  const [speed, setSpeed] = useState<Speed>(1);
  const [loop, setLoop] = useState(false);
  const [looping, setLooping] = useState(false);

  const recRef = useRef<Recording | undefined>(undefined);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout>; loop?: ReturnType<typeof setTimeout> }>({});
  const mounted = useRef(true);
  const loopRef = useRef(false);
  const shadowRun = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);
  const shadowRef = useRef<() => Promise<void>>(async () => undefined);
  loopRef.current = loop;

  const clearTimers = () => {
    clearInterval(timers.current.tick);
    clearTimeout(timers.current.stop);
  };

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void micPermission().then((p) => alive && setPermission(p));
    return () => {
      alive = false;
      mounted.current = false;
      clearTimers();
      clearTimeout(timers.current.loop);
      recRef.current?.cancel();
    };
  }, []);
  useEffect(() => () => (playback ? URL.revokeObjectURL(playback) : undefined), [playback]);

  const start = useCallback(async () => {
    setError(undefined);
    setPhase('starting');
    onStart?.();
    try {
      const r = await startRecording(variety, { onInterim, recognize });
      if (!mounted.current) return r.cancel();
      recRef.current = r;
      setRec(r);
      setPermission('granted');
      setElapsed(0);
      setPhase('recording');
      const t0 = Date.now();
      timers.current.tick = setInterval(() => setElapsed(Date.now() - t0), 200);
      timers.current.stop = setTimeout(() => void stopRef.current(), max);
    } catch (e) {
      if (!mounted.current) return;
      const kind = micErrorKind(e);
      setError(kind);
      if (kind === 'denied') setPermission('denied');
      setPhase('idle');
      shadowRun.current = false;
    }
  }, [variety, onInterim, onStart, recognize, max]);

  const stop = useCallback(async () => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = undefined;
    clearTimers();
    setPhase('stopping');
    const out = await r.stop();
    if (!mounted.current) return;
    setRec(undefined);
    setPhase('idle');
    setHasTake(true);
    setPlayback(out.audio ? URL.createObjectURL(out.audio) : undefined);
    onRecorded?.({ audio: out.audio, transcript: out.transcript, recognized: r.recognizing });
    if (shadowRun.current && loopRef.current) {
      timers.current.loop = setTimeout(() => void shadowRef.current(), 900);
    } else {
      shadowRun.current = false;
      setLooping(false);
    }
  }, [onRecorded]);
  stopRef.current = stop;

  const playModel = async () => {
    setPhase('playing-native');
    try {
      return await playNative({ url: nativeUrl, text, variety, rate: speed });
    } finally {
      if (mounted.current) setPhase('idle');
    }
  };

  /** Shadowing: native model at the chosen speed, then record straight away. */
  const shadow = async () => {
    if (!mounted.current) return;
    shadowRun.current = true;
    setLooping(loopRef.current);
    await playModel();
    if (!mounted.current || !shadowRun.current) return;
    await start();
  };
  shadowRef.current = shadow;

  const stopLoop = () => {
    setLoop(false);
    setLooping(false);
    shadowRun.current = false;
    clearTimeout(timers.current.loop);
  };

  const recording = phase === 'recording';
  const busy = phase === 'starting' || phase === 'stopping' || phase === 'playing-native';

  if (!supported) {
    return (
      <div className="space-y-2">
        <p role="note" className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
          Recording isn't available in this browser. Listen, say the sentence aloud, then rate yourself.
        </p>
        <NativeButton native={native} text={text} variety={variety} url={nativeUrl} speed={speed} />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="recorder">
      {permission === 'prompt' && !error && !hasTake && (
        <p className="text-xs text-muted">Your browser will ask for the microphone the first time. Recordings stay on this device.</p>
      )}
      {(error || permission === 'denied') && (
        <div role="alert" className="space-y-1 rounded-xl border border-bad/40 bg-bad-soft px-3 py-2 text-sm">
          <p className="font-semibold text-bad">{ERROR_TEXT[error ?? 'denied']}</p>
          {(error ?? 'denied') === 'denied' && (
            <>
              <p>To turn it on:</p>
              <ol className="list-decimal pl-5">
                {micFixSteps().map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="text-muted">You can still listen and rate yourself.</p>
            </>
          )}
        </div>
      )}

      {shadowing && (
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Shadowing</legend>
          <div role="radiogroup" aria-label="Speed" className="inline-flex overflow-hidden rounded-full border border-line">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                className={`px-3 py-1 text-sm ${speed === s ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:text-fg'}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={loop} onChange={(e) => (e.target.checked ? setLoop(true) : stopLoop())} />
            Loop this line
          </label>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button type="button" className="btn-primary bg-swiss" onClick={() => void stop()}>
            <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> Stop recording
          </button>
        ) : (
          <>
            {shadowing && native !== 'none' && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void shadow()}>
                {phase === 'playing-native' ? 'Listen…' : 'Listen, then speak'}
              </button>
            )}
            <button
              type="button"
              className={shadowing && native !== 'none' ? 'btn-secondary' : 'btn-primary'}
              disabled={busy}
              onClick={() => void start()}
            >
              {hasTake ? 'Record again' : 'Record'}
            </button>
          </>
        )}
        {looping && !recording && (
          <button type="button" className="btn-ghost" onClick={stopLoop}>
            Stop loop
          </button>
        )}
      </div>

      {recording && (
        <div className="space-y-1">
          <LevelMeter stream={rec?.stream} />
          <p role="timer" aria-live="off" className="text-xs tabular-nums text-muted">
            Recording {fmt(elapsed)} / {fmt(max)}
          </p>
        </div>
      )}
      {phase === 'starting' && (
        <p role="status" className="text-xs text-muted">
          Starting the microphone…
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">You</p>
          {playback ? (
            <audio controls src={playback} className="h-10 w-full" aria-label="Your recording">
              <track kind="captions" />
            </audio>
          ) : (
            <p className="text-sm text-muted">{hasTake ? 'No audio was captured (recognition only).' : 'Not recorded yet.'}</p>
          )}
        </div>
        <div className="rounded-xl border border-line p-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Native</p>
          <NativeButton native={native} text={text} variety={variety} url={nativeUrl} speed={speed} />
        </div>
      </div>
    </div>
  );
}

function NativeButton({
  native,
  text,
  variety,
  url,
  speed,
}: {
  native: 'audio' | 'tts' | 'none';
  text: string;
  variety: Variety;
  url?: string;
  speed: number;
}) {
  const [playing, setPlaying] = useState(false);
  if (native === 'none') return <p className="text-sm text-muted">No recording yet</p>;
  return (
    <button
      type="button"
      className="btn-secondary"
      aria-pressed={playing}
      onClick={async () => {
        setPlaying(true);
        try {
          await playNative({ url, text, variety, rate: speed });
        } finally {
          setPlaying(false);
        }
      }}
    >
      {native === 'audio' ? 'Play native' : 'Play native (synthetic voice)'}
      {speed !== 1 && <span className="text-xs text-muted"> {speed}×</span>}
    </button>
  );
}
