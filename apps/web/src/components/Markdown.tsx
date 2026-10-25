import type { ReactNode } from 'react';

/**
 * Small, safe Markdown renderer for grammar notes and docs: paragraphs, headings, bullet and
 * numbered lists, simple tables, **bold**, *italic*, `code` and [links](https://…). No HTML is
 * passed through; only http(s), same-site and #anchor links become links.
 *
 * `headings="document"` maps `#`/`##` to h2, `###` to h3 and `####` to h4 (for a page that has its
 * own h1) and treats single line breaks as spaces, as in a Markdown file; the default renders every
 * heading as h4 (inside a card) and keeps line breaks.
 */
export function Markdown({ text, className = '', headings = 'flat' }: { text: string; className?: string; headings?: 'flat' | 'document' }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.flatMap((b, i) => splitHeadings(b.trim()).map((part, j) => <Block key={`${i}-${j}`} src={part} headings={headings} />))}
    </div>
  );
}

/** A heading line directly followed by text (no blank line) becomes its own block. */
function splitHeadings(src: string): string[] {
  const lines = src.split('\n');
  if (lines.length > 1 && /^#{1,4}\s/.test(lines[0] ?? '')) return [lines[0]!, lines.slice(1).join('\n')];
  return [src];
}

const HEADING_CLASS = { 2: 'pt-2 text-lg font-semibold', 3: 'pt-1 text-base font-semibold', 4: 'pt-1 font-semibold' } as const;

/** Document mode: indented continuation lines join the line (list item) above. */
function unwrap(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out.length - 1;
    if (prev >= 0 && /^\s+\S/.test(l) && !/^\s*([-*]|\d+[.)])\s+/.test(l)) out[prev] = `${out[prev]} ${l.trim()}`;
    else out.push(l);
  }
  return out;
}

function Block({ src, headings }: { src: string; headings: 'flat' | 'document' }) {
  if (!src) return null;
  const doc = headings === 'document';
  const lines = doc ? unwrap(src.split('\n')) : src.split('\n');
  const heading = /^(#{1,4})\s+(.*)$/.exec(src);
  if (heading && lines.length === 1) {
    const depth = heading[1]?.length ?? 4;
    const level = headings === 'document' ? (Math.min(4, Math.max(2, depth)) as 2 | 3 | 4) : 4;
    const H = `h${level}` as const;
    return <H className={HEADING_CLASS[level]}>{inline(heading[2] ?? '')}</H>;
  }
  if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) return <Table lines={lines} />;
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
  // Document mode: soft line breaks inside a paragraph are spaces.
  if (doc) return <p>{inline(lines.join(' '))}</p>;
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

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function Table({ lines }: { lines: string[] }) {
  const isRule = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
  const head = isRule(lines[1] ?? '') ? cells(lines[0]!) : undefined;
  const body = (head ? lines.slice(2) : lines).filter((l) => !isRule(l)).map(cells);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        {head && (
          <thead>
            <tr className="text-muted">
              {head.map((c, i) => (
                <th key={i} scope="col" className="py-1 pr-3 font-medium">
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => (
                <td key={j} className="py-1 pr-3">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#)/;

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
    if (link) {
      const [, label = '', href = ''] = link;
      if (SAFE_HREF.test(href)) {
        const external = /^https?:/.test(href);
        out.push(
          <a key={k++} href={href} className="text-accent underline" {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
            {label}
          </a>,
        );
      } else out.push(label);
    } else if (tok.startsWith('**')) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k++} className="rounded bg-surface-2 px-1 text-[0.95em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
