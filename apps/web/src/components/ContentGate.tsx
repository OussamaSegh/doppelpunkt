import type { ReactNode } from 'react';
import { useContent } from '../content';
import { EmptyState } from './EmptyState';

/** Renders children once packs are loaded; otherwise a loading, empty or error state. */
export function ContentGate({ children }: { children: ReactNode }) {
  const { status, error, warnings, load } = useContent();
  if (status === 'idle' || status === 'loading') {
    return (
      <p role="status" className="p-6 text-center text-muted">
        Loading lessons…
      </p>
    );
  }
  if (status === 'error') {
    return (
      <EmptyState title="Lessons could not be loaded" action={<button className="btn-primary" onClick={() => void load()}>Try again</button>}>
        <p>{error}</p>
        <p className="mt-1">If you are offline, open the app once online so lessons can be saved for offline use.</p>
      </EmptyState>
    );
  }
  if (status === 'empty') {
    return (
      <EmptyState title="No lessons installed yet" action={<button className="btn-secondary" onClick={() => void load()}>Check again</button>}>
        <p>Content packs are missing from <code>/packs</code>.</p>
        <p className="mt-1">
          Developers: run <code>npm run content:build</code> to compile <code>content/</code> into <code>apps/web/public/packs</code>.
        </p>
        {warnings.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-left">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </EmptyState>
    );
  }
  return <>{children}</>;
}
