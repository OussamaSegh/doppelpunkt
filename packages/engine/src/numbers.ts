// German number words 0–100 (Standard German and common Zurich/Bernese spellings) mapped to
// digits, so a speech transcript that says "3" matches a target that says "drei" and vice versa.
// Keys are lower-case with ß folded to ss; umlaut-less and ae/oe/ue spellings are included.

const UNITS: Array<[number, string[]]> = [
  [1, ['ein', 'eins']],
  [2, ['zwei', 'zwo']],
  [3, ['drei']],
  [4, ['vier']],
  [5, ['fünf', 'fuenf', 'funf']],
  [6, ['sechs']],
  [7, ['sieben']],
  [8, ['acht']],
  [9, ['neun']],
];

const TEENS: Array<[number, string[]]> = [
  [0, ['null']],
  [10, ['zehn']],
  [11, ['elf']],
  [12, ['zwölf', 'zwoelf', 'zwolf']],
  [13, ['dreizehn']],
  [14, ['vierzehn']],
  [15, ['fünfzehn', 'fuenfzehn', 'funfzehn']],
  [16, ['sechzehn']],
  [17, ['siebzehn']],
  [18, ['achtzehn']],
  [19, ['neunzehn']],
  [100, ['hundert', 'einhundert']],
];

const TENS: Array<[number, string[]]> = [
  [20, ['zwanzig']],
  [30, ['dreissig', 'dreißig']],
  [40, ['vierzig']],
  [50, ['fünfzig', 'fuenfzig', 'funfzig']],
  [60, ['sechzig']],
  [70, ['siebzig']],
  [80, ['achtzig']],
  [90, ['neunzig']],
];

/** Swiss German number words (Dieth-style spellings), used for gsw-zh / gsw-be only. */
const GSW: Array<[number, string[]]> = [
  [1, ['eis']],
  [2, ['zwöi', 'zwoi', 'zwee']],
  [3, ['drü', 'dru', 'drüü']],
  [4, ['vieri']],
  [5, ['föif', 'foif', 'füüf', 'fuuf', 'füf']],
  [6, ['sächs', 'sachs']],
  [7, ['sibe', 'sibä']],
  [8, ['achti']],
  [9, ['nüün', 'nün', 'nuun', 'nüni']],
  [10, ['zää', 'zäh', 'zaa', 'zähni', 'zäni']],
  [11, ['elfi']],
  [12, ['zwölfi']],
  [20, ['zwänzg', 'zwanzg', 'zwänzig']],
];

const fold = (s: string) => s.toLocaleLowerCase('de-CH').replace(/ß/g, 'ss');

function buildTable(): Map<string, number> {
  const m = new Map<string, number>();
  const put = (n: number, words: string[]) => words.forEach((w) => m.set(fold(w), n));
  for (const [n, w] of [...UNITS, ...TEENS, ...TENS]) put(n, w);
  // einundzwanzig … neunundneunzig (also umlaut-less spellings via the variant lists).
  for (const [t, tw] of TENS) {
    for (const [u, uw] of UNITS) {
      const unitForms = u === 1 ? ['ein'] : uw;
      put(t + u, unitForms.flatMap((a) => tw.map((b) => `${a}und${b}`)));
    }
  }
  return m;
}

const STANDARD = buildTable();
const SWISS = new Map<string, number>([...STANDARD]);
for (const [n, words] of GSW) words.forEach((w) => SWISS.set(fold(w), n));
// "ein" is an article in running text; only "eins" (and the digit) stand for the number.
STANDARD.delete('ein');
SWISS.delete('ein');

/**
 * Digits for a German number word 0–100 ("drei" → "3", "einundzwanzig" → "21"), or the input
 * when it is not a number word. Digits are returned unchanged (leading zeros removed).
 */
export function numberKey(word: string, swiss = false): string {
  const w = fold(word);
  if (/^\d+$/.test(w)) return String(Number(w));
  const n = (swiss ? SWISS : STANDARD).get(w);
  return n === undefined ? word : String(n);
}

/** Forms of the indefinite article that a recogniser sometimes writes as the digit 1. */
export function isOneWord(word: string, swiss = false): boolean {
  const w = fold(word);
  return ONE_DE.has(w) || (swiss && ONE_GSW.has(w));
}
const ONE_DE = new Set(['ein', 'eine', 'einen', 'einem', 'einer', 'eines', 'eins']);
const ONE_GSW = new Set(['e', 'en', 'es', 'ei', 'eis', 'äi', 'ä']);
