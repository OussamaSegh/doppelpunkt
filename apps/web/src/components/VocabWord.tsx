import type { VocabItem } from '@doppelpunkt/content-schema';
import { VarietyTag } from './VarietyTag';

const ARTICLE = { m: 'der', f: 'die', n: 'das' } as const;
const GENDER_CLASS = { m: 'text-der', f: 'text-die', n: 'text-das' } as const;
const GENDER_NAME = { m: 'masculine', f: 'feminine', n: 'neuter' } as const;

/** Splits "der Tisch" / "Tisch" into article + word using the item's gender. */
export function splitArticle(v: Pick<VocabItem, 'de' | 'gender' | 'pos'>): { article?: string; word: string } {
  const m = /^(der|die|das)\s+(.+)$/i.exec(v.de);
  if (m) return { article: (m[1] ?? '').toLowerCase(), word: m[2] ?? v.de };
  if (v.pos === 'noun' && v.gender) return { article: ARTICLE[v.gender], word: v.de };
  return { word: v.de };
}

/** German word with its article coloured by gender (der blue, die red, das green). */
export function VocabWord({ item, className = '' }: { item: VocabItem; className?: string }) {
  const { article, word } = splitArticle(item);
  const g = item.gender;
  return (
    <span lang="de-DE" className={`inline-flex flex-wrap items-baseline gap-x-1.5 ${className}`}>
      <VarietyTag variety="de" className="self-center" />
      {article && g && (
        <span className={`font-bold ${GENDER_CLASS[g]}`} title={GENDER_NAME[g]}>
          {article}
        </span>
      )}
      <span className="font-semibold">{word}</span>
      {g && <span className="sr-only">({GENDER_NAME[g]})</span>}
    </span>
  );
}

/** Swiss forms of a vocab item (Helvetism, Zurich, Bern), each with its tag. */
export function SwissForms({ item }: { item: VocabItem }) {
  const forms = [
    item.chStd ? { v: 'ch-std' as const, t: item.chStd } : undefined,
    item.gswZh ? { v: 'gsw-zh' as const, t: item.gswZh } : undefined,
    item.gswBe ? { v: 'gsw-be' as const, t: item.gswBe } : undefined,
  ].filter((x) => x !== undefined);
  if (!forms.length) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {forms.map((f) => (
        <span key={f.v} className="inline-flex items-center gap-1" lang={f.v === 'ch-std' ? 'de-CH' : 'gsw'}>
          <VarietyTag variety={f.v} /> {f.t}
        </span>
      ))}
    </span>
  );
}
