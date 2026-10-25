// What a listening item plays (its `transcript`): a recording when there is one, otherwise TTS for
// Standard German. The transcript itself is only shown after answering (or in the exam review);
// Swiss German without a recording has no TTS, so the learner reads it instead.
import { useState } from 'react';
import type { Exercise, Variety } from '@doppelpunkt/content-schema';
import { VarietyTag } from '../components/VarietyTag';
import { canSpeak, playNative } from '../lib/speech';
import { VARIETY_META } from '../lib/varieties';

const SPEAKER = /^\s*[A-ZÄÖÜ][\p{L}. ]{0,24}:\s*/u;

/** The text to read aloud: speaker labels ("Frau:", "Sprecher:") mark a change of voice and are not spoken. */
export function spokenText(transcript: string): string {
  return transcript
    .split('\n')
    .map((l) => l.replace(SPEAKER, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** The listening transcript of an item, if it has one (dictation keeps its own, graded transcript). */
export function listeningTranscript(ex: Exercise): string | undefined {
  if (ex.type === 'dictation') return undefined;
  return ex.transcript?.trim() || undefined;
}

const isGsw = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

/** Can this transcript be heard here (recording, or TTS for de / ch-std)? */
export function canHear(variety: Variety, url?: string): boolean {
  return !!url || (!isGsw(variety) && canSpeak());
}

function PlayButton({ text, variety, url, rate, label, name }: { text: string; variety: Variety; url?: string; rate?: number; label: string; name: string }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    setPlaying(true);
    try {
      await playNative({ url, text: spokenText(text), variety, rate });
    } finally {
      setPlaying(false);
    }
  };
  return (
    <button type="button" onClick={play} aria-pressed={playing} aria-label={name} className="btn-secondary inline-flex items-center gap-1.5">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
      </svg>
      {label}
    </button>
  );
}

/** The transcript as text, one speaker turn per line. */
export function TranscriptText({ text, variety, className = '' }: { text: string; variety: Variety; className?: string }) {
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      <VarietyTag variety={variety} className="mt-1" />
      <p lang={VARIETY_META[variety].lang} className="min-w-0 flex-1 whitespace-pre-line leading-relaxed">
        {text}
      </p>
    </div>
  );
}

/**
 * Shown above the answer input of a listening item. Plays the transcript without showing it; when it
 * can't be heard (Swiss German without a recording, or no TTS on this device) the learner reads it.
 */
export function ListenPanel({
  text,
  variety,
  url,
  id,
  what = 'the recording',
  after = 'after you answer',
}: {
  text: string;
  variety: Variety;
  url?: string;
  id: string;
  /** Names the play buttons for screen readers ("Play item 3"). */
  what?: string;
  /** When the transcript is shown ("after you answer"). */
  after?: string;
}) {
  if (!canHear(variety, url)) {
    return (
      <section aria-labelledby={`listen-${id}`} className="mb-4 space-y-2 rounded-xl border border-line bg-surface-2 p-3">
        <p id={`listen-${id}`} className="text-sm font-semibold">
          {isGsw(variety) ? 'No recording yet — read instead' : "This device can't read German aloud — read instead"}
        </p>
        <p className="text-xs text-muted">Read it once at normal speed, as if you heard it, then answer.</p>
        <TranscriptText text={text} variety={variety} />
      </section>
    );
  }
  return (
    <section aria-labelledby={`listen-${id}`} className="mb-4 space-y-2 rounded-xl border border-line bg-surface-2 p-3">
      <p id={`listen-${id}`} className="text-sm font-semibold">
        Listen{url ? '' : ' (synthetic voice)'}, then answer
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <VarietyTag variety={variety} />
        <PlayButton text={text} variety={variety} url={url} label="Play" name={`Play ${what}`} />
        <PlayButton text={text} variety={variety} url={url} rate={0.75} label="Slower" name={`Play ${what} slower`} />
      </div>
      <p className="text-xs text-muted">The transcript is shown {after}.</p>
    </section>
  );
}
