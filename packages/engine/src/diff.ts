import { tokenize, type NormalizeOptions, type Token } from './normalize';

/**
 * One word of a diff between an expected text and a learner's text.
 * - same:    the word matches; `text` is the expected surface form
 * - missing: an expected word the learner left out; `text` is the expected word
 * - extra:   a word the learner added; `text` is the learner's word
 * - wrong:   the learner wrote `text` where `expected` was due
 */
export type DiffToken = { text: string; kind: 'same' | 'missing' | 'extra' | 'wrong'; expected?: string };

/** Longest-common-subsequence alignment over token keys. Returns index pairs. */
export function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/** LCS length divided by the longer sequence length (0..1). */
export function lcsRatio(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : lcsPairs(a, b).length / len;
}

export function diffTokens(exp: Token[], act: Token[]): DiffToken[] {
  const pairs = lcsPairs(exp.map((t) => t.key), act.map((t) => t.key));
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  const flushGap = (iEnd: number, jEnd: number) => {
    const missing = exp.slice(i, iEnd);
    const extra = act.slice(j, jEnd);
    const k = Math.min(missing.length, extra.length);
    for (let x = 0; x < k; x++) out.push({ text: extra[x]!.surface, kind: 'wrong', expected: missing[x]!.surface });
    for (const t of missing.slice(k)) out.push({ text: t.surface, kind: 'missing' });
    for (const t of extra.slice(k)) out.push({ text: t.surface, kind: 'extra' });
  };
  for (const [pi, pj] of pairs) {
    flushGap(pi, pj);
    out.push({ text: exp[pi]!.surface, kind: 'same' });
    i = pi + 1;
    j = pj + 1;
  }
  flushGap(exp.length, act.length);
  return out;
}

/**
 * Word-level diff of `actual` against `expected`. Tokens are compared after normalisation
 * (case-insensitive, ß = ss, quotes unified, punctuation ignored); the result carries the
 * original surface forms.
 */
export function diffWords(expected: string, actual: string, opts: NormalizeOptions = {}): DiffToken[] {
  return diffTokens(tokenize(expected, opts), tokenize(actual, opts));
}
