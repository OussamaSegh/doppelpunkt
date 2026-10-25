import { useState } from 'react';
import type { Variety } from '@doppelpunkt/content-schema';
import { GermanText } from './GermanText';
import { Recorder } from './Recorder';

export type ShadowLine = { speaker?: string; text: string; en?: string; variety: Variety; url?: string };

/**
 * Shadowing for a list of lines (a dialogue): pick a line, hear it at 0.75×–1.25×, speak straight
 * after it, loop it until it sits. Nothing is graded here.
 */
export function ShadowPanel({ lines, onClose }: { lines: ShadowLine[]; onClose?: () => void }) {
  const [i, setI] = useState(0);
  const line = lines[i];
  if (!line) return null;
  return (
    <section aria-label="Shadowing" className="card space-y-3 border-accent/40">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Shadowing</h3>
        {onClose && (
          <button type="button" className="btn-ghost px-2 text-sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <p className="text-sm text-muted">Listen to the line, then say it straight after the speaker. Slow it down first, then try full speed.</p>
      <nav aria-label="Lines" className="flex items-center justify-between gap-2">
        <button type="button" className="btn-secondary" disabled={i === 0} onClick={() => setI(i - 1)}>
          ← Previous line
        </button>
        <span className="text-sm tabular-nums text-muted" aria-live="polite">
          Line {i + 1} of {lines.length}
        </span>
        <button type="button" className="btn-secondary" disabled={i === lines.length - 1} onClick={() => setI(i + 1)}>
          Next line →
        </button>
      </nav>
      <div>
        {line.speaker && <p className="text-xs font-semibold text-muted">{line.speaker}</p>}
        <GermanText text={line.text} variety={line.variety} className="text-lg" />
        {line.en && <p className="mt-1 pl-9 text-sm text-muted">{line.en}</p>}
      </div>
      {/* key: a fresh recorder (and recording) per line. */}
      <Recorder key={i} text={line.text} variety={line.variety} nativeUrl={line.url} shadowing recognize={false} />
    </section>
  );
}
