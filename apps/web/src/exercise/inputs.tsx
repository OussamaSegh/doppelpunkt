// Answer inputs for the closed exercise types. Each reports a complete engine Answer or undefined.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { GermanText } from '../components/GermanText';
import { AudioButton } from '../components/AudioButton';
import { VarietyTag } from '../components/VarietyTag';
import { audioUrl } from '../content';
import { useCardKeys } from '../lib/keys';
import { VARIETY_META } from '../lib/varieties';
import { seededShuffle } from './shuffle';
import { orderAnswer, type InputProps } from './types';
import { UmlautBar } from './UmlautBar';

export function McqInput({ ex, disabled, onChange }: InputProps<'mcq'>) {
  const [picked, setPicked] = useState<number>();
  // Authors often list the correct option first; show a stable shuffled order instead.
  const order = useMemo(() => seededShuffle(ex.options.map((_, i) => i), ex.id), [ex.id, ex.options]);
  const pick = (i: number) => {
    setPicked(i);
    onChange(i);
  };
  const box = useRef<HTMLDivElement>(null);
  // Number keys pick the option shown at that position.
  useCardKeys(
    box,
    (e) => {
      if (e.ctrlKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
      const i = order[Number(e.key) - 1];
      if (i === undefined) return;
      pick(i);
      return true;
    },
    !disabled,
  );
  return (
    <div ref={box}>
      {ex.question && <GermanText text={ex.question} variety={ex.variety} className="mb-3 text-lg" />}
      <div role="radiogroup" aria-label="Options" className="grid gap-2">
        {order.map((i, pos) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked === i}
            aria-keyshortcuts={pos < 9 ? String(pos + 1) : undefined}
            data-kbd-option=""
            disabled={disabled}
            onClick={() => pick(i)}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-base transition-colors ${
              picked === i ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            {pos < 9 && (
              <kbd aria-hidden="true" className="hidden h-6 w-6 shrink-0 place-items-center rounded-md border border-line text-xs text-muted sm:grid">
                {pos + 1}
              </kbd>
            )}
            <span lang={VARIETY_META[ex.variety].lang}>{ex.options[i]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function GapInput({ ex, disabled, onChange }: InputProps<'gap'>) {
  const parts = useMemo(() => ex.text.split('___'), [ex.text]);
  const gaps = parts.length - 1;
  const [values, setValues] = useState<string[]>(() => Array.from({ length: gaps }, () => ''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [focused, setFocused] = useState(0);

  const update = (i: number, v: string) => {
    const next = values.map((x, j) => (j === i ? v : x));
    setValues(next);
    onChange(next.every((x) => x.trim()) ? next : undefined);
  };

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1 gap-y-2 text-lg leading-relaxed">
        <VarietyTag variety={ex.variety} className="mr-1" />
        <span lang={VARIETY_META[ex.variety].lang} className="contents">
          {parts.map((p, i) => (
            <span key={i} className="contents">
              <span>{p}</span>
              {i < gaps && (
                <input
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  aria-label={`Gap ${i + 1}`}
                  className="input inline-block w-32 px-2 py-1 text-center"
                  value={values[i] ?? ''}
                  disabled={disabled}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onFocus={() => setFocused(i)}
                  onChange={(e) => update(i, e.target.value)}
                />
              )}
            </span>
          ))}
        </span>
      </p>
      {!disabled && <UmlautBar target={() => refs.current[focused] ?? null} onInsert={(v) => update(focused, v)} />}
    </div>
  );
}

export function OrderInput({ ex, disabled, onChange }: InputProps<'order'>) {
  const pool = useMemo(() => seededShuffle(ex.tokens.map((t, i) => ({ t, i })), ex.id), [ex.id, ex.tokens]);
  const [built, setBuilt] = useState<number[]>([]);

  const set = (next: number[]) => {
    setBuilt(next);
    onChange(next.length === ex.tokens.length ? orderAnswer(next.map((i) => ex.tokens[i] ?? '')) : undefined);
  };

  return (
    <div className="space-y-3">
      <div
        className="flex min-h-14 flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-line p-2"
        role="group"
        aria-label="Your sentence"
        aria-live="polite"
      >
        <VarietyTag variety={ex.variety} />
        {built.length === 0 && <span className="text-sm text-muted">Tap the words in the right order.</span>}
        {built.map((i, pos) => (
          <button
            key={`${i}-${pos}`}
            type="button"
            disabled={disabled}
            className="rounded-lg bg-accent-soft px-3 py-1.5 text-base font-medium text-accent"
            onClick={() => set(built.filter((_, p) => p !== pos))}
            aria-label={`Remove ${ex.tokens[i]}`}
          >
            {ex.tokens[i]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Words">
        {pool.map(({ t, i }) => {
          const used = built.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled || used}
              className={`rounded-lg border border-line px-3 py-1.5 text-base ${used ? 'opacity-30' : 'bg-surface hover:bg-surface-2'}`}
              onClick={() => set([...built, i])}
            >
              {t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MatchInput({ ex, disabled, onChange }: InputProps<'match'>) {
  const left = ex.pairs.map((p) => p[0]);
  const right = useMemo(() => seededShuffle(ex.pairs.map((p) => p[1]), ex.id), [ex.id, ex.pairs]);
  const [active, setActive] = useState<string>();
  const [pairs, setPairs] = useState<Record<string, string>>({});

  const choose = (r: string) => {
    if (!active) return;
    const next = Object.fromEntries(Object.entries(pairs).filter(([, v]) => v !== r));
    next[active] = r;
    setPairs(next);
    setActive(left.find((l) => !(l in next)));
    const complete = left.every((l) => l in next);
    onChange(complete ? left.map((l): [string, string] => [l, next[l] ?? '']) : undefined);
  };

  const rightUsedBy = (r: string) => Object.keys(pairs).find((l) => pairs[l] === r);

  return (
    <div className="grid grid-cols-2 gap-3">
      <ul className="space-y-2" aria-label="Match these">
        {left.map((l) => (
          <li key={l}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={active === l}
              onClick={() => setActive(l)}
              className={`w-full rounded-xl border px-3 py-2 text-left ${active === l ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
            >
              <span className="block">{l}</span>
              <span className="block text-xs text-muted">{pairs[l] ? `→ ${pairs[l]}` : 'not matched'}</span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="space-y-2" aria-label="With these">
        {right.map((r) => {
          const by = rightUsedBy(r);
          return (
            <li key={r}>
              <button
                type="button"
                disabled={disabled || !active}
                onClick={() => choose(r)}
                className={`w-full rounded-xl border px-3 py-2 text-left ${by ? 'border-ok/50 bg-ok-soft' : 'border-line bg-surface hover:bg-surface-2'}`}
              >
                {r}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="col-span-2 text-xs text-muted">Pick an item on the left, then its partner on the right.</p>
    </div>
  );
}

/** Free-text answer shared by dictation, translate and transform. */
function TextAnswer({
  label,
  disabled,
  onChange,
  multiline = false,
  lang,
  children,
}: {
  label: string;
  disabled: boolean;
  onChange: (v: string | undefined) => void;
  multiline?: boolean;
  lang?: string;
  children?: ReactNode;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const update = (v: string) => {
    setValue(v);
    onChange(v.trim() ? v : undefined);
  };
  const common = {
    'aria-label': label,
    className: 'input text-lg',
    value,
    disabled,
    lang,
    autoComplete: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
  } as const;
  return (
    <div className="space-y-2">
      {children}
      {multiline ? (
        <textarea {...common} ref={ref} rows={3} onChange={(e) => update(e.target.value)} />
      ) : (
        <input {...common} ref={ref} onChange={(e) => update(e.target.value)} />
      )}
      {!disabled && <UmlautBar target={() => ref.current} onInsert={update} />}
    </div>
  );
}

export function DictationInput({ ex, unit, disabled, onChange }: InputProps<'dictation'>) {
  const url = ex.audio ? audioUrl(unit, ex.audio) : undefined;
  return (
    <TextAnswer label="What you heard" disabled={disabled} onChange={onChange} multiline lang={VARIETY_META[ex.variety].lang}>
      <div className="flex items-center gap-2">
        <VarietyTag variety={ex.variety} />
        <AudioButton text={ex.transcript} variety={ex.variety} url={url} label="Play" className="border border-line" />
        <AudioButton text={ex.transcript} variety={ex.variety} url={url} rate={0.7} label="Slow" className="border border-line" />
      </div>
    </TextAnswer>
  );
}

export function TranslateInput({ ex, disabled, onChange }: InputProps<'translate'>) {
  return (
    <TextAnswer label="Your translation" disabled={disabled} onChange={onChange} multiline lang={VARIETY_META[ex.variety].lang}>
      <blockquote className="rounded-xl bg-surface-2 px-4 py-3 text-lg">{ex.source}</blockquote>
      <p className="flex items-center gap-2 text-sm text-muted">
        Translate into <VarietyTag variety={ex.variety} /> {VARIETY_META[ex.variety].name}
      </p>
    </TextAnswer>
  );
}

export function TransformInput({ ex, disabled, onChange }: InputProps<'transform'>) {
  return (
    <TextAnswer label={`Rewrite in ${VARIETY_META[ex.to].name}`} disabled={disabled} onChange={onChange} lang={VARIETY_META[ex.to].lang}>
      <GermanText text={ex.source} variety={ex.from} className="rounded-xl bg-surface-2 px-4 py-3 text-lg" />
      <p className="flex items-center gap-2 text-sm text-muted">
        <VarietyTag variety={ex.from} /> → <VarietyTag variety={ex.to} /> {VARIETY_META[ex.to].name}
      </p>
    </TextAnswer>
  );
}
