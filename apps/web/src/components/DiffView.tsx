import type { DiffToken } from '@doppelpunkt/engine';

const STYLE: Record<DiffToken['kind'], string> = {
  same: 'text-fg',
  missing: 'rounded bg-ok-soft px-1 text-ok underline decoration-dotted',
  extra: 'rounded bg-bad-soft px-1 text-bad line-through',
  wrong: 'rounded bg-bad-soft px-1 text-bad',
};

const LABEL: Record<DiffToken['kind'], string> = {
  same: '',
  missing: 'missing',
  extra: 'not needed',
  wrong: 'wrong',
};

/** Word-level comparison of the learner's answer with the expected one. */
export function DiffView({ tokens }: { tokens: DiffToken[] }) {
  if (!tokens.length) return null;
  return (
    <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-base" aria-label="Word by word comparison">
      {tokens.map((t, i) => (
        <span key={i} className={STYLE[t.kind]} title={LABEL[t.kind] || undefined}>
          {t.text}
          {t.kind !== 'same' && <span className="sr-only"> ({LABEL[t.kind]})</span>}
        </span>
      ))}
    </p>
  );
}
