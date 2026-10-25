import type { ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for grammar notes: paragraphs, headings, bullet and numbered
 * lists, **bold**, *italic* and `code`. No HTML is passed through.
 */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((b, i) => (
        <Block key={i} src={b.trim()} />
      ))}
    </div>
  );
}

function Block({ src }: { src: string }) {
  if (!src) return null;
  const lines = src.split('\n');
  const heading = /^(#{1,4})\s+(.*)$/.exec(src);
  if (heading && lines.length === 1) {
    return <h4 className="pt-1 font-semibold">{inline(heading[2] ?? '')}</h4>;
  }
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return (
      <ol className="list-decimal space-y-1 pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
        ))}
      </ol>
    );
  }
  return (
    <p>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {inline(l)}
        </span>
      ))}
    </p>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k++} className="rounded bg-surface-2 px-1 text-[0.95em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
