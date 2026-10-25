import type { ReactNode } from 'react';

export function EmptyState({ title, children, action, headingLevel = 2 }: { title: string; children?: ReactNode; action?: ReactNode; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <div className="card mx-auto max-w-lg text-center" role="status">
      <div aria-hidden="true" className="mx-auto mb-3 flex w-8 flex-col items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-gold" />
        <span className="h-3 w-3 rounded-full bg-swiss" />
      </div>
      <Heading className="text-lg font-semibold">{title}</Heading>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
