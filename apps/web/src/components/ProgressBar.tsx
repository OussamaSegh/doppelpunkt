export function ProgressBar({ value, label, tone = 'accent' }: { value: number; label: string; tone?: 'accent' | 'gold' | 'swiss' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const bar = tone === 'gold' ? 'bg-gold' : tone === 'swiss' ? 'bg-swiss' : 'bg-accent';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={`h-full rounded-full ${bar} transition-[width]`} style={{ width: `${pct}%` }} />
    </div>
  );
}
