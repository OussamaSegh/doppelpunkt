// Deterministic graders for every closed exercise type. No AI is needed for these.
import type { Exercise, Variety } from '@doppelpunkt/content-schema';
import { diffTokens, lcsPairs, lcsRatio, type DiffToken } from './diff';
import { gswFold, levenshtein, sentenceKey, tokenize, wordKey, type Token } from './normalize';
import { gradeSpeech, type PronunciationHint } from './speech';

export type { DiffToken } from './diff';

export type GradeResult = {
  correct: boolean;
  /** 0..1 */
  score: number;
  /** Plain-English feedback lines (hints), possibly empty. */
  feedback: string[];
  /** The model answer (or the accepted answer closest to the learner's). */
  expected: string;
  diff?: DiffToken[];
  /** Per-part correctness: gaps (gap), pairs (match). */
  parts?: boolean[];
  /** true when the deterministic grader cannot judge this answer (write, roleplay, unknown translation). */
  needsAi?: boolean;
  /** Speaking: pronunciation issues typical for English speakers, with the affected words. */
  hints?: PronunciationHint[];
};

/** mcq: option index · gap: string[] (one per gap; a string is accepted for single-gap items) ·
 * order: sentence or token array · match: [left, right] pairs · others: string. */
export type Answer = number | string | string[] | Array<[string, string]>;

/** Score given when only letter case differs (Standard German). */
export const CASE_SCORE = 0.5;
/** Score given for a near miss (edit distance ≤ 1 per word; an adjacent swap counts as 1). */
export const ALMOST_SCORE = 0.7;
export { SPEAK_PASS } from './speech';

const isGsw = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

// ---------------------------------------------------------------------------------------------
// Text comparison against a list of accepted answers

type Lang = 'de' | 'en';
type Ctx = { variety: Variety; initialCaseFree: boolean; lang: Lang };
type Outcome = { rank: number; correct: boolean; score: number; feedback: string[]; candidate: string };

const RANK = { exact: 5, accepted: 4, caseOnly: 3, almost: 2, wrong: 1 } as const;

const EN_WORDS = new Set(
  'the a an is are am i you he she it we they my your his her our and to of from what where how do does not this that please thank thanks hello good morning evening name yes no with for at be have has'.split(' '),
);
const DE_WORDS = new Set(
  'der die das den dem des ein eine einen ist bin bist sind ich du er sie es wir ihr und nicht mein meine aus wie wo heisse heiße heisst heißt guten danke bitte hallo ja nein mit für zu im am auf'.split(' '),
);

/** Heuristic: is this accepted answer English (a German -> English translation)? */
export function looksEnglish(s: string): boolean {
  if (/[äöüß]/i.test(s)) return false;
  let en = 0;
  let de = 0;
  for (const t of tokenize(s)) {
    if (EN_WORDS.has(t.key)) en++;
    if (DE_WORDS.has(t.key)) de++;
  }
  return en > de;
}

const quote = (s: string) => `“${s}”`;

function lowerFirst(s: string): string {
  return s.length ? s[0]!.toLocaleLowerCase('de-CH') + s.slice(1) : s;
}

function strictKey(s: string, ctx: Ctx, umlautFallback = false): string {
  if (ctx.lang === 'en') return sentenceKey(s);
  const key = sentenceKey(s, { caseSensitive: true, umlautFallback });
  return ctx.initialCaseFree ? lowerFirst(key) : key;
}

function eszettHint(expected: string, actual: string, ctx: Ctx): string[] {
  if (ctx.lang === 'en') return [];
  const eHas = /ß/.test(expected);
  const aHas = /ß/.test(actual);
  if (eHas && !aHas && ctx.variety === 'de') {
    const word = tokenize(expected).find((t) => t.surface.includes('ß'))?.surface.replace(/[.,!?;:]+$/, '') ?? 'Straße';
    return [`In Germany and Austria this is spelled with ß (${quote(word)}); ss is the Swiss spelling. Both are accepted.`];
  }
  if (!eHas && aHas && ctx.variety !== 'de') {
    return ['Swiss spelling never uses ß: write ss instead (for example “Strasse”). Both are accepted.'];
  }
  return [];
}

/** Pairs of expected/actual words (by position) whose comparison keys differ under `key`. */
function differingWords(expected: string, actual: string, key: (w: string) => string): Array<[Token, Token, number]> {
  const e = tokenize(expected);
  const a = tokenize(actual);
  if (e.length !== a.length) return [];
  const out: Array<[Token, Token, number]> = [];
  e.forEach((t, i) => {
    if (key(t.surface) !== key(a[i]!.surface)) out.push([t, a[i]!, i]);
  });
  return out;
}

const clean = (t: Token) => t.surface.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function umlautHint(expected: string, actual: string): string {
  const words = differingWords(expected, actual, (w) => wordKey(w));
  const first = words[0];
  return first
    ? `ae/oe/ue are accepted for ä/ö/ü, but the correct spelling is ${quote(clean(first[0]))}.`
    : 'ae/oe/ue are accepted for ä/ö/ü, but try to type the umlaut.';
}

function caseHint(expected: string, actual: string, ctx: Ctx): string {
  const words = differingWords(expected, actual, (w) => wordKey(w, { caseSensitive: true, umlautFallback: true }))
    .filter(([, , i]) => !(ctx.initialCaseFree && i === 0));
  const first = words[0];
  if (!first) return 'Check capital letters: in German every noun starts with a capital letter.';
  const e = clean(first[0]);
  const a = clean(first[1]);
  if (e[0] && e[0] !== e[0].toLocaleLowerCase('de-CH')) {
    return `Capitalise nouns in German: write ${quote(e)}, not ${quote(a)}.`;
  }
  return `Only nouns (and the polite Sie) start with a capital letter: write ${quote(e)}, not ${quote(a)}.`;
}

function nearMiss(expected: string, actual: string, ctx: Ctx): string | null {
  const fold = (s: string) => (isGsw(ctx.variety) ? gswFold(s) : sentenceKey(s, { umlautFallback: ctx.lang === 'de' }));
  const e = fold(expected).split(' ');
  const a = fold(actual).split(' ');
  if (e.length !== a.length || e.length === 0) return null;
  let bad = -1;
  for (let i = 0; i < e.length; i++) {
    const d = levenshtein(e[i]!, a[i]!, true);
    if (d > 1) return null;
    if (d === 1 && bad < 0) bad = i;
  }
  if (bad < 0) return null;
  const et = tokenize(expected)[bad];
  const at = tokenize(actual)[bad];
  if (!et || !at) return 'Almost! Check your spelling.';
  return `Almost! ${quote(clean(at))} should be ${quote(clean(et))}.`;
}

function compareOne(candidate: string, actual: string, ctx: Ctx): Outcome {
  const base = { candidate };
  if (strictKey(candidate, ctx) === strictKey(actual, ctx)) {
    return { ...base, rank: RANK.exact, correct: true, score: 1, feedback: eszettHint(candidate, actual, ctx) };
  }
  if (ctx.lang === 'de' && strictKey(candidate, ctx, true) === strictKey(actual, ctx, true)) {
    return {
      ...base, rank: RANK.accepted, correct: true, score: 1,
      feedback: [umlautHint(candidate, actual), ...eszettHint(candidate, actual, ctx)],
    };
  }
  const ci = (s: string) => sentenceKey(s, { umlautFallback: true });
  if (ci(candidate) === ci(actual)) {
    const hint = caseHint(candidate, actual, ctx);
    if (isGsw(ctx.variety)) return { ...base, rank: RANK.accepted, correct: true, score: 1, feedback: [hint] };
    return { ...base, rank: RANK.caseOnly, correct: false, score: CASE_SCORE, feedback: [hint] };
  }
  if (isGsw(ctx.variety) && gswFold(candidate) === gswFold(actual)) {
    return {
      ...base, rank: RANK.accepted, correct: true, score: 1,
      feedback: [`Swiss German has no fixed spelling, so we accept yours. The spelling used here is ${quote(candidate)}.`],
    };
  }
  const almost = nearMiss(candidate, actual, ctx);
  if (almost) return { ...base, rank: RANK.almost, correct: false, score: ALMOST_SCORE, feedback: [almost] };
  const keys = (s: string) => (isGsw(ctx.variety) ? gswFold(s) : ci(s)).split(' ').filter(Boolean);
  return { ...base, rank: RANK.wrong, correct: false, score: 0.5 * lcsRatio(keys(candidate), keys(actual)), feedback: [] };
}

/** Compare a learner answer to every accepted answer and keep the best outcome. */
export function compareText(candidates: string[], actual: string, ctx: Ctx): Outcome {
  let best: Outcome | null = null;
  for (const c of candidates) {
    const o = compareOne(c, actual, ctx);
    if (!best || o.rank > best.rank || (o.rank === best.rank && o.score > best.score)) best = o;
    if (best.rank === RANK.exact) break;
  }
  return best ?? { rank: RANK.wrong, correct: false, score: 0, feedback: [], candidate: '' };
}

// ---------------------------------------------------------------------------------------------
// Per-type graders

type Of<T extends Exercise['type']> = Extract<Exercise, { type: T }>;

const asString = (a: Answer): string =>
  typeof a === 'string' ? a : Array.isArray(a) ? (a as unknown[]).map((x) => (Array.isArray(x) ? x.join(' ') : String(x))).join(' ') : String(a);

function gradeMcq(ex: Of<'mcq'>, answer: Answer): GradeResult {
  const expected = ex.options[ex.answer] ?? '';
  const idx = typeof answer === 'number' ? answer : Number.NaN;
  const correct = idx === ex.answer;
  const feedback: string[] = [];
  const rationale = Number.isInteger(idx) ? ex.rationales?.[idx] : undefined;
  if (rationale) feedback.push(rationale);
  if (!correct && !Number.isInteger(idx)) feedback.push('Pick one of the options.');
  return { correct, score: correct ? 1 : 0, feedback, expected };
}

function gapIsSentenceInitial(segments: string[], i: number): boolean {
  const before = segments[i] ?? '';
  if (i === 0 && before.trim() === '') return true;
  return /[.!?:„"«]\s*$/.test(before) || /\n\s*$/.test(before);
}

function gradeGap(ex: Of<'gap'>, answer: Answer): GradeResult {
  const given: string[] = typeof answer === 'string' ? [answer] : Array.isArray(answer) ? (answer as unknown[]).map((x) => String(x ?? '')) : [];
  const segments = ex.text.split('___');
  const multi = ex.answers.length > 1;
  const feedback: string[] = [];
  const parts: boolean[] = [];
  let total = 0;
  ex.answers.forEach((accepted, i) => {
    const prefix = multi ? `Gap ${i + 1}: ` : '';
    const actual = (given[i] ?? '').trim();
    if (!actual) {
      parts.push(false);
      feedback.push(multi ? `Gap ${i + 1} is empty.` : 'The gap is empty.');
      return;
    }
    const o = compareText(accepted, actual, {
      variety: ex.variety,
      initialCaseFree: gapIsSentenceInitial(segments, i),
      lang: 'de',
    });
    parts.push(o.correct);
    total += o.score;
    for (const f of o.feedback) feedback.push(prefix + f);
    if (!o.correct && o.rank === RANK.wrong) feedback.push(`${prefix}${quote(actual)} is not right here.`);
  });
  const expected = segments.reduce(
    (acc, seg, i) => acc + seg + (i < ex.answers.length ? (ex.answers[i]?.[0] ?? '') : ''),
    '',
  );
  const score = ex.answers.length ? total / ex.answers.length : 0;
  return { correct: parts.every(Boolean) && parts.length > 0, score, feedback, expected, parts };
}

const WORD_ORDER_HINT =
  'Check the word order: in a main clause the conjugated verb is in position 2; after weil, dass, wenn and other subordinating conjunctions it goes to the end.';

function gradeOrder(ex: Of<'order'>, answer: Answer): GradeResult {
  const actual = asString(answer);
  const key = (s: string) => sentenceKey(s, { umlautFallback: true });
  const actualKey = key(actual);
  const hit = ex.answers.find((a) => key(a) === actualKey);
  if (hit) return { correct: true, score: 1, feedback: [], expected: hit, diff: diffTokens(tokenize(hit), tokenize(actual)) };
  let best = ex.answers[0]!;
  let bestRatio = -1;
  for (const a of ex.answers) {
    const r = lcsRatio(key(a).split(' '), actualKey.split(' '));
    if (r > bestRatio) {
      bestRatio = r;
      best = a;
    }
  }
  const sorted = (s: string) => key(s).split(' ').filter(Boolean).sort().join(' ');
  const feedback = [sorted(actual) === sorted(ex.tokens.join(' ')) ? WORD_ORDER_HINT : 'Use each word exactly once.'];
  return {
    correct: false,
    score: 0.5 * Math.max(0, bestRatio),
    feedback,
    expected: best,
    diff: diffTokens(tokenize(best), tokenize(actual)),
  };
}

function gradeMatch(ex: Of<'match'>, answer: Answer): GradeResult {
  const k = (s: string) => sentenceKey(s);
  const given = new Map<string, string>();
  if (Array.isArray(answer)) {
    for (const p of answer as unknown[]) {
      if (Array.isArray(p) && p.length === 2) given.set(k(String(p[0])), k(String(p[1])));
    }
  }
  const feedback: string[] = [];
  const parts = ex.pairs.map(([l, r]) => {
    const ok = given.get(k(l)) === k(r);
    if (!ok) feedback.push(`${quote(l)} goes with ${quote(r)}.`);
    return ok;
  });
  const right = parts.filter(Boolean).length;
  return {
    correct: right === ex.pairs.length,
    score: right / ex.pairs.length,
    feedback,
    expected: ex.pairs.map(([l, r]) => `${l} = ${r}`).join('; '),
    parts,
  };
}

/** Tokens for word-by-word comparison; Swiss German tokens use the spelling-tolerant fold. */
function wordTokens(s: string, variety: Variety, umlautFallback = false): Token[] {
  const toks = tokenize(s, { umlautFallback });
  return isGsw(variety) ? toks.map((t) => ({ surface: t.surface, key: gswFold(t.surface) })) : toks;
}

function gradeDictation(ex: Of<'dictation'>, answer: Answer): GradeResult {
  const actual = asString(answer);
  const exp = wordTokens(ex.transcript, ex.variety);
  const act = wordTokens(actual, ex.variety);
  const pairs = lcsPairs(exp.map((t) => t.key), act.map((t) => t.key));
  let caseErrors = 0;
  let caseExample: string | null = null;
  for (const [i, j] of pairs) {
    if (isGsw(ex.variety)) break;
    const e = exp[i]!;
    const a = act[j]!;
    const prev = exp[i - 1];
    const initial = i === 0 || (prev !== undefined && /[.!?:]["“”'»]?$/.test(prev.surface));
    if (!initial && wordKey(e.surface, { caseSensitive: true }) !== wordKey(a.surface, { caseSensitive: true })) {
      caseErrors++;
      caseExample ??= caseHint(clean(e), clean(a), { variety: ex.variety, initialCaseFree: false, lang: 'de' });
    }
  }
  let diff = diffTokens(exp, act);
  let umlautMatches = 0;
  diff = diff.map((d) => {
    if (d.kind === 'wrong' && d.expected && wordKey(d.expected, { umlautFallback: true }) === wordKey(d.text, { umlautFallback: true })) {
      umlautMatches++;
      return { text: d.expected, kind: 'same' };
    }
    return d;
  });
  const feedback: string[] = [];
  if (umlautMatches) feedback.push('ae/oe/ue are accepted for ä/ö/ü, but try to type the umlauts.');
  if (caseExample) feedback.push(caseExample);
  const missed = diff.filter((d) => d.kind === 'missing' || d.kind === 'wrong').map((d) => quote(d.expected ?? d.text));
  if (missed.length) feedback.push(`Listen again for: ${missed.slice(0, 5).join(', ')}${missed.length > 5 ? ' …' : ''}.`);
  if (diff.some((d) => d.kind === 'extra')) feedback.push('Some words you wrote are not in the recording.');
  const total = exp.length || 1;
  const matched = pairs.length - 0.5 * caseErrors + umlautMatches;
  const extras = diff.filter((d) => d.kind === 'extra').length;
  const score = Math.max(0, Math.min(1, matched / total));
  const correct = matched >= exp.length && extras === 0 && caseErrors === 0;
  return { correct, score, feedback, expected: ex.transcript, diff };
}

function gradeSentence(
  candidates: string[],
  answer: Answer,
  variety: Variety,
  allowAi: boolean,
): GradeResult {
  const actual = asString(answer).trim();
  const lang: Lang = looksEnglish(candidates[0] ?? '') ? 'en' : 'de';
  if (!actual) {
    return { correct: false, score: 0, feedback: ['Write your answer first.'], expected: candidates[0] ?? '' };
  }
  const o = compareText(candidates, actual, { variety, initialCaseFree: true, lang });
  const expected = o.rank >= RANK.almost ? o.candidate : (candidates[0] ?? '');
  const res: GradeResult = {
    correct: o.correct,
    score: o.score,
    feedback: o.feedback,
    expected,
    diff: diffTokens(wordTokens(expected, variety), wordTokens(actual, variety)),
  };
  if (o.rank === RANK.wrong) {
    res.feedback = ['Not quite. Compare your answer with the model answer.'];
    if (allowAi) res.needsAi = true;
  }
  return res;
}

function gradeSpeak(ex: Of<'speak'>, answer: Answer): GradeResult {
  return gradeSpeech(ex.target, asString(answer), { variety: ex.variety });
}

/** true for exercise types that can only be judged by AI (or a self-check); with a result, also for unknown translations. */
export function needsAiGrading(ex: Exercise, result?: GradeResult): boolean {
  if (ex.type === 'write' || ex.type === 'roleplay') return true;
  return Boolean(result?.needsAi);
}

/** Grade a learner answer. Never throws for closed types; write/roleplay return `needsAi: true`. */
export function grade(ex: Exercise, answer: Answer): GradeResult {
  switch (ex.type) {
    case 'mcq': return gradeMcq(ex, answer);
    case 'gap': return gradeGap(ex, answer);
    case 'order': return gradeOrder(ex, answer);
    case 'match': return gradeMatch(ex, answer);
    case 'dictation': return gradeDictation(ex, answer);
    case 'translate': return gradeSentence(ex.answers, answer, ex.variety, true);
    case 'transform': return gradeSentence(ex.answers, answer, ex.to, false);
    case 'speak': return gradeSpeak(ex, answer);
    case 'write':
    case 'roleplay':
      return {
        correct: false,
        score: 0,
        feedback: ['This task needs AI feedback, or check your answer yourself against the model and the checklist.'],
        expected: ex.model,
        needsAi: true,
      };
  }
}
