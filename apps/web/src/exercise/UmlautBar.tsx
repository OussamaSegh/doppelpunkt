const CHARS = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'];

/** Buttons that insert German characters at the caret of the target input. */
export function UmlautBar({ target, onInsert }: { target: () => HTMLInputElement | HTMLTextAreaElement | null; onInsert: (next: string) => void }) {
  const insert = (ch: string) => {
    const el = target();
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + ch + el.value.slice(end);
    onInsert(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ch.length, start + ch.length);
    });
  };
  return (
    <div className="mt-2 flex flex-wrap gap-1" aria-label="Insert special characters">
      {CHARS.map((c) => (
        <button key={c} type="button" className="h-8 w-8 rounded-lg border border-line bg-surface-2 text-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c)} aria-label={`Insert ${c}`}>
          {c}
        </button>
      ))}
    </div>
  );
}
