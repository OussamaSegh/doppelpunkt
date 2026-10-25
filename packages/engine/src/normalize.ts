// Text normalisation and token helpers shared by every grader.
//
// Design notes
// - ß and ss are always treated as equal (Swiss spelling never uses ß). The graders add a
//   hint when the spelling differs from the expected variety.
// - Umlaut fallback works by expanding ä/ö/ü to ae/oe/ue on BOTH sides, never the other way
//   round, so words such as "Feuer" or "Israel" are never mangled.

export type NormalizeOptions = {
  /** Treat ae/oe/ue as ä/ö/ü (expands umlauts on both sides). Default false. */
  umlautFallback?: boolean;
  /** Keep letter case. Default false: the result is lower-cased. */
  caseSensitive?: boolean;
  /** Strip final punctuation (. ! ? … , ; :). Default true. */
  stripFinalPunctuation?: boolean;
};

const DOUBLE_QUOTES = /[“”„‟«»″〝〞]/g;
const SINGLE_QUOTES = /[‘’‚‛‹›´`′]/g;
const FINAL_PUNCT = /[\s.!?…,;:]+$/u;
/** Punctuation stripped from both ends of every token when comparing words. */
const EDGE_PUNCT = /^[\s"'.!?…,;:()[\]{}«»\-–—/]+|[\s"'.!?…,;:()[\]{}«»\-–—/]+$/gu;

export function unifyQuotes(s: string): string {
  return s.replace(DOUBLE_QUOTES, '"').replace(SINGLE_QUOTES, "'");
}

export function expandUmlauts(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue');
}

/** ß -> ss, ẞ -> SS. */
export function foldEszett(s: string): string {
  return s.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS');
}

/**
 * Normalise a learner answer or an expected answer for comparison:
 * NFC, trim, collapse whitespace, unify quotes/apostrophes, ß -> ss, optional umlaut fallback,
 * optional case folding (default: case-insensitive), strip final punctuation.
 */
export function normalize(s: string, opts: NormalizeOptions = {}): string {
  let out = unifyQuotes(s.normalize('NFC')).replace(/\s+/g, ' ').trim();
  if (opts.stripFinalPunctuation !== false) out = out.replace(FINAL_PUNCT, '');
  out = foldEszett(out);
  if (opts.umlautFallback) out = expandUmlauts(out);
  if (!opts.caseSensitive) out = out.toLocaleLowerCase('de-CH');
  return out.trim();
}

export type Token = { surface: string; key: string };

/** Comparison key for a single word: normalised, edge punctuation and apostrophes removed. */
export function wordKey(word: string, opts: NormalizeOptions = {}): string {
  return normalize(word, { ...opts, stripFinalPunctuation: false })
    .replace(EDGE_PUNCT, '')
    .replace(/'/g, '');
}

/** Split into tokens (by whitespace), keeping the surface form; tokens that are pure punctuation are dropped. */
export function tokenize(s: string, opts: NormalizeOptions = {}): Token[] {
  return unifyQuotes(s.normalize('NFC'))
    .split(/\s+/)
    .filter(Boolean)
    .map((surface) => ({ surface, key: wordKey(surface, opts) }))
    .filter((t) => t.key.length > 0);
}

/** Sentence comparison key: word keys joined by single spaces (internal punctuation ignored). */
export function sentenceKey(s: string, opts: NormalizeOptions = {}): string {
  return tokenize(s, opts).map((t) => t.key).join(' ');
}

/**
 * Fold a Swiss German (dialect) string so that common spelling variants compare equal:
 * case, ß/ss, ä~e alternation, y~i (Wy/Wii), "scht"/"schp" ~ "st"/"sp", ie ~ i, and doubled
 * vowels or consonants (Grüezii/Grüezi, Merci vilmal/vielmal, choschtet/chostet).
 */
export function gswFold(s: string): string {
  return sentenceKey(s)
    .replace(/ä/g, 'e')
    .replace(/y/g, 'i')
    .replace(/sch(?=[tp])/g, 's')
    .replace(/ie/g, 'i')
    .replace(/([a-zäöü])\1+/g, '$1');
}

/**
 * Edit distance over code points. With `transpositions`, swapping two adjacent letters counts as
 * one edit (optimal string alignment), which matches common typing slips ("Schwiez").
 */
export function levenshtein(a: string, b: string, transpositions = false): number {
  if (a === b) return 0;
  const A = [...a];
  const B = [...b];
  if (A.length === 0) return B.length;
  if (B.length === 0) return A.length;
  const d: number[][] = Array.from({ length: A.length + 1 }, (_, i) =>
    Array.from({ length: B.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (transpositions && i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[A.length]![B.length]!;
}
