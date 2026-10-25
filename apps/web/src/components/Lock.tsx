import { Link } from 'react-router-dom';

/** Small padlock. Decorative: pair it with text (or an sr-only label). */
export function LockIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`inline-block shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Shown instead of a locked unit or mock exam. */
export function LockedNotice({ level, what }: { level: string; what: string }) {
  return (
    <section className="card space-y-3 border-gold/50 text-center" aria-labelledby="locked-title">
      <p className="flex justify-center text-gold-strong">
        <LockIcon className="h-8 w-8" />
      </p>
      <h1 id="locked-title" className="text-xl font-bold">
        {what} is part of {level}
      </h1>
      <p className="text-sm text-muted">
        A1 is free, and unit 1 of every level is a free preview. Unlock {level} to continue: once unlocked, it works offline on this device, no
        account needed.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to={`/unlock/${level}`} className="btn-primary">
          Unlock {level}
        </Link>
        <Link to={`/learn/${level}`} className="btn-secondary">
          Back to {level}
        </Link>
      </div>
    </section>
  );
}
