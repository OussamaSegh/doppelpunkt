import { useState } from 'react';
import type { Variety } from '@doppelpunkt/content-schema';
import { playOrSpeak } from '../lib/speech';

type Props = { text: string; variety?: Variety; url?: string; rate?: number; label?: string; className?: string };

/** Plays the recording when there is one, otherwise reads the text with a German TTS voice. */
export function AudioButton({ text, variety = 'de', url, rate, label, className = '' }: Props) {
  const [playing, setPlaying] = useState(false);
  const onClick = async () => {
    setPlaying(true);
    try {
      await playOrSpeak({ url, text, variety, rate });
    } finally {
      setPlaying(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 text-accent hover:bg-accent-soft ${className}`}
      aria-label={label ?? `Listen: ${text}`}
      aria-pressed={playing}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
      </svg>
      {label && <span className="text-xs font-semibold">{label}</span>}
    </button>
  );
}
