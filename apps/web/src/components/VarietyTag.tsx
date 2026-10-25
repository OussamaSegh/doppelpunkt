import type { Variety } from '@doppelpunkt/content-schema';
import { VARIETY_META } from '../lib/varieties';

/** Small DE / CH / ZH / BE badge: gold for Standard German, red for Swiss varieties. */
export function VarietyTag({ variety, className = '' }: { variety: Variety; className?: string }) {
  const meta = VARIETY_META[variety];
  const tone = meta.swiss
    ? 'border-swiss/40 bg-swiss-soft text-swiss-strong'
    : 'border-gold/40 bg-gold-soft text-gold-strong';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 align-middle text-[10px] font-bold leading-none tracking-wide ${tone} ${className}`}
      title={meta.name}
      aria-label={meta.name}
      role="img"
    >
      {meta.tag}
    </span>
  );
}
