import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from './Markdown';

/** "**[OPERATOR NAME]**"-style placeholders that the operator still has to fill in. */
export const hasPlaceholders = (md: string) => /\[[A-Z][A-Z0-9 ,./()'"-]{2,}[\]:,(]/.test(md);

/** Drops the document's own h1 (the page renders its own). */
export const withoutTitle = (md: string) => md.replace(/\r\n/g, '\n').replace(/^# .*\n/, '').trim();

/** A legal document from docs/ (bundled as text), with links to the other legal pages. */
export function LegalPage({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{title}</h1>
      {hasPlaceholders(text) && (
        <p className="card border-gold/50 text-sm" role="note">
          Draft: the parts in [square brackets] are placeholders that the operator of this site must fill in.
        </p>
      )}
      {children}
      <article className="card">
        <Markdown text={text} headings="document" className="text-sm leading-relaxed" />
      </article>
      <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to="/privacy" className="text-accent underline">
          Privacy policy
        </Link>
        <Link to="/terms" className="text-accent underline">
          Terms of use
        </Link>
        <Link to="/imprint" className="text-accent underline">
          Imprint
        </Link>
        <Link to="/about" className="text-accent underline">
          About Doppelpunkt
        </Link>
      </nav>
    </div>
  );
}
