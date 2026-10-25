// Grammar reference: every grammar point across the loaded packs, with accent-insensitive search.
import type { CompiledUnit, Exercise, GrammarPoint, Level, LevelPack } from '@doppelpunkt/content-schema';

export type GrammarEntry = { point: GrammarPoint; unit: CompiledUnit; level: Level };

export function grammarIndex(packs: LevelPack[]): GrammarEntry[] {
  return packs.flatMap((p) => p.units.flatMap((unit) => unit.grammar.map((point) => ({ point, unit, level: p.level }))));
}

/** Lower case, no diacritics, ß → ss: "Über" and "uber" match, "Straße" and "strasse" match. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLowerCase();
}

/** Like fold, but writes umlauts the way people type them without a German keyboard (ü → ue). */
function foldUmlautsAsE(s: string): string {
  return fold(s.normalize('NFC').replace(/[äöü]/gi, (c) => `${c}e`));
}

function searchText(p: GrammarPoint): string {
  return [p.title, p.body, ...p.tables.flat(2), ...p.commonMistakes].join('\n');
}

/** Entries whose title or body contain every word of the query, title matches first. */
export function searchGrammar(entries: GrammarEntry[], query: string): GrammarEntry[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  const scored: Array<{ e: GrammarEntry; rank: number }> = [];
  for (const e of entries) {
    const full = searchText(e.point);
    const hay = [fold(full), foldUmlautsAsE(full)];
    if (!terms.every((t) => hay.some((h) => h.includes(t)))) continue;
    const title = [fold(e.point.title), foldUmlautsAsE(e.point.title)];
    const inTitle = terms.filter((t) => title.some((h) => h.includes(t))).length;
    scored.push({ e, rank: inTitle });
  }
  return scored.sort((a, b) => b.rank - a.rank).map((x) => x.e);
}

/** A short plain-text excerpt around the first match (or the start of the body). */
export function excerpt(point: GrammarPoint, query: string, length = 120): string {
  const plain = point.body.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim();
  const term = fold(query).split(/\s+/).find(Boolean);
  const at = term ? fold(plain).indexOf(term) : -1;
  if (at < 0) return plain.length > length ? `${plain.slice(0, length).trimEnd()}…` : plain;
  const from = Math.max(0, at - Math.floor(length / 3));
  const out = plain.slice(from, from + length).trim();
  return `${from > 0 ? '…' : ''}${out}${from + length < plain.length ? '…' : ''}`;
}

const isSwissDialect = (ex: Exercise) => ex.variety === 'gsw-zh' || ex.variety === 'gsw-be';

/** The unit's exercises that practise a grammar point, with the step each lives in. */
export function exercisesFor(unit: CompiledUnit, grammarId: string): Array<{ ex: Exercise; step: 'uebungen' | 'schwiiz' }> {
  return unit.exercises
    .filter((ex) => ex.grammar.includes(grammarId))
    .map((ex) => ({ ex, step: isSwissDialect(ex) ? 'schwiiz' : 'uebungen' }));
}
