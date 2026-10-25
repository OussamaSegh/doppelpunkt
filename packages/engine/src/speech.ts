// Speaking grader: compares a speech-recognition transcript with the target text.
//
// Recognisers (Web Speech API, Whisper, Gemini) produce artefacts that are not the learner's
// fault, so the comparison tolerates them:
// - case and punctuation, ß/ss, ae/oe/ue for ä/ö/ü;
// - numbers written as digits or words ("drei" / "3", "einundzwanzig" / "21", "1 Kaffee" for
//   "einen Kaffee"); an umlaut-less number word ("funf" for "fünf", "zwolf") gets near credit
//   and the ü / ö hint, because the recogniser heard u / o;
// - filler words (äh, ähm, hm) that are not in the target;
// - compounds split or joined ("Kaffee Tasse" / "Kaffeetasse", "Kaffee-Tasse").
// Words that differ by a sound English speakers typically get wrong (ü said as u, ch as k,
// final -er as -a, w/v, ...) earn half credit and a pronunciation hint keyed to the issue.
import type { Variety } from '@doppelpunkt/content-schema';
import type { DiffToken } from './diff';
import type { GradeResult } from './grade';
import { isOneWord, numberKey } from './numbers';
import { expandUmlauts, levenshtein, unifyQuotes } from './normalize';

/** Minimum share of recognised words for a speaking item to count as correct. */
export const SPEAK_PASS = 0.8;
/** Credit for a word that matches except for a typical pronunciation issue. */
export const SPEECH_NEAR_CREDIT = 0.5;

export type PronunciationIssue = 'ue' | 'oe' | 'ae' | 'ch' | 'er' | 'w-v' | 'z' | 'ei-ie' | 'length' | 'j';

export type PronunciationHint = {
  id: PronunciationIssue;
  /** Short name of the sound, e.g. "ü sound". */
  label: string;
  /** How to make the sound, in English. */
  tip: string;
  /** Target words and what the recogniser heard instead. */
  words: Array<{ expected: string; heard: string }>;
};

/** A substitution [pattern, replacements, 'gsw' = Swiss German only]. `$1` in a replacement is the first group. */
type Sub = [RegExp, string[]] | [RegExp, string[], 'gsw'];
type Rule = { id: PronunciationIssue; label: string; tip: string; subs: Sub[] };

/** Typical English-speaker issues, in the order hints are reported. */
export const PRONUNCIATION_RULES: readonly Rule[] = [
  {
    id: 'ue', label: 'ü sound',
    tip: 'Say “ee” and round your lips as if for “oo”, keeping the tongue forward: Tür, müde, fünf.',
    subs: [[/ü/, ['u', 'i', 'ue']]],
  },
  {
    id: 'oe', label: 'ö sound',
    tip: 'Say “e” as in “hey” and round your lips as if for “o”: schön, hören, zwölf.',
    subs: [[/ö/, ['o', 'e']]],
  },
  {
    id: 'ae', label: 'ä sound',
    tip: 'ä is an open “e” as in “bed”, not an “a”: Mädchen, Käse, hätte.',
    subs: [[/ä/, ['a']]],
  },
  {
    id: 'ch', label: 'ch sound (ich-Laut / ach-Laut)',
    tip: 'German ch is never “k” or “sh”. After i, e, ä, ö, ü and consonants it is a soft hiss (ich, nicht); after a, o, u it is a rasp at the back of the throat (ach, Buch).',
    subs: [[/(?<=[a-zäöüy])(?<!s)ch(?!s)/, ['k', 'ck', 'sch', 'sh', 'h', 'g', '']], [/^ch(?=[aeiouäöüy])/, ['k', 'h', 'sch'], 'gsw']],
  },
  {
    id: 'er', label: 'final -er',
    tip: 'A final -er is a short, relaxed “uh” with no hard r: Vater, Lehrer, aber.',
    subs: [[/(?<=..)er$/, ['a', 'ah', 'ar', 'ur', 'or', 'e']]],
  },
  {
    id: 'w-v', label: 'w and v',
    tip: 'German w sounds like English v (Wasser, wie); German v usually sounds like f (Vater, viel).',
    subs: [[/w/, ['v']], [/v/, ['w']]],
  },
  {
    id: 'z', label: 'z sound',
    tip: 'German z is “ts” as at the end of “cats”: zwei, Zug, Zeit.',
    subs: [[/z/, ['s']]],
  },
  {
    id: 'ei-ie', label: 'ei and ie',
    tip: 'ei sounds like English “eye” (mein, drei); ie like English “ee” (Bier, vier). The second letter tells you the sound.',
    subs: [[/ei/, ['ie', 'ee', 'i']], [/ie/, ['ei', 'ai']]],
  },
  {
    id: 'length', label: 'vowel length',
    tip: 'Hold long vowels (ah, ee, ie, aa, a vowel before one consonant) and keep vowels short before a double consonant: Staat/Stadt, Hüte/Hütte, bieten/bitten.',
    subs: [
      [/(?<=[aeiouäöü])h(?![aeiouäöü])/, ['']],
      [/(aa|ee|oo)/, ['a', 'e', 'o']],
      [/ie/, ['i']],
      [/([bdfgklmnprst])\1/, ['$1']],
      [/(?<=[aeiouäöü])([bdfgklmnprst])(?=[aeiouäöü]|$)/, ['$1$1']],
    ],
  },
  {
    id: 'j', label: 'j sound',
    tip: 'German j sounds like English y: ja, jetzt, Januar.',
    subs: [[/^j/, ['dsch', 'dj', 'g', 'sch']]],
  },
];
const RULE_BY_ID = new Map(PRONUNCIATION_RULES.map((r) => [r.id, r]));

const isGsw = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

type Tok = {
  surface: string;
  /** Lower case, ß→ss, punctuation and hyphens removed; umlauts kept. */
  raw: string;
  /** Comparison key: raw with numbers as digits and umlauts expanded (Swiss: gswFold). */
  key: string;
};

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function rawOf(word: string): string {
  return unifyQuotes(word.normalize('NFC'))
    .toLocaleLowerCase('de-CH')
    .replace(/ß/g, 'ss')
    .replace(EDGE, '')
    .replace(/['\-‐‑–—.]/g, '');
}

function keyOf(raw: string, swiss: boolean): string {
  const n = numberKey(raw, swiss);
  if (/^\d+$/.test(n)) return n;
  return swiss ? speechGswFold(n) : expandUmlauts(n);
}

/**
 * Swiss German spelling fold for speech: like gswFold (ä~e, y~i, scht/st, doubled consonants) but
 * keeping ie, ü/ue and long/short vowels apart, because they are minimal pairs in dialect
 * (wie/Wii, Brueder/Brüeder, Füür/für).
 */
function speechGswFold(word: string): string {
  return word
    .toLocaleLowerCase('de-CH')
    .replace(/ä/g, 'e')
    .replace(/y/g, 'i')
    .replace(/sch(?=[tp])/g, 's')
    .replace(/([b-df-hj-np-tv-z])\1+/g, '$1');
}

const FILLERS = /^(ä+h+m*|ä+m+|ää+|e+h+m*|ö+h*m*|h+m+|m+h*m+|a+h+m*|u+h+m*|uh)$/;

function toks(s: string, swiss: boolean): Tok[] {
  return unifyQuotes(s.normalize('NFC'))
    .split(/[\s/]+/)
    .filter(Boolean)
    .map((surface) => {
      const raw = rawOf(surface);
      return { surface: surface.replace(EDGE, '') || surface, raw, key: keyOf(raw, swiss) };
    })
    .filter((t) => t.raw.length > 0);
}

/** Variants of `word` after one substitution of `rule` (each occurrence on its own, and all at once). */
function applyRule(word: string, rule: Rule, swiss: boolean): string[] {
  const out = new Set<string>();
  for (const [re, reps, only] of rule.subs) {
    if (only === 'gsw' && !swiss) continue;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const hits = [...word.matchAll(g)].length;
    for (const rep of reps) {
      const expand = (groups: unknown[]) => rep.replace(/\$(\d)/g, (_, d: string) => String(groups[Number(d)] ?? ''));
      for (let target = -1; target < (hits > 1 ? hits : 0); target++) {
        let n = 0;
        out.add(word.replace(g, (m: string, ...rest: unknown[]) => {
          const hit = target < 0 || n === target;
          n++;
          return hit ? expand([m, ...rest]) : m;
        }));
      }
    }
  }
  out.delete(word);
  return [...out];
}

/** Issues that turn the target word into the heard word (one or two rules), or null. */
export function pronunciationIssues(expected: string, heard: string, variety: Variety = 'de'): PronunciationIssue[] | null {
  const swiss = isGsw(variety);
  const e = rawOf(expected);
  const a = rawOf(heard);
  if (!e || !a || e === a) return null;
  const same = (x: string) => (swiss ? speechGswFold(x) === speechGswFold(a) : x === a);
  let frontier: Array<{ w: string; ids: PronunciationIssue[] }> = [{ w: e, ids: [] }];
  for (let depth = 0; depth < 2; depth++) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const rule of PRONUNCIATION_RULES) {
        for (const v of applyRule(f.w, rule, swiss)) {
          const ids = f.ids.includes(rule.id) ? f.ids : [...f.ids, rule.id];
          if (same(v)) return ids;
          next.push({ w: v, ids });
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Umlaut issues when `heard` is the umlaut-less spelling of `expected` (fünf → funf, zwölf → zwolf,
 * fünfzig → funfzig). ae/oe/ue spellings (fuenf) and digits are recogniser style, not a mistake.
 */
function lostUmlauts(expected: string, heard: string): PronunciationIssue[] | null {
  if (/^\d+$/.test(heard) || expandUmlauts(expected) === heard) return null;
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
  const out: PronunciationIssue[] = [];
  for (const [id, u, alt] of [['ue', /ü/g, /ü|ue/g], ['oe', /ö/g, /ö|oe/g], ['ae', /ä/g, /ä|ae/g]] as const) {
    if (count(expected, u) > count(heard, alt)) out.push(id);
  }
  return out.length ? out : null;
}

type Match = { kind: 'exact' } | { kind: 'near'; issues: PronunciationIssue[] } | { kind: 'similar' } | null;

function matchWords(e: Tok, a: Tok, variety: Variety): Match {
  const swiss = isGsw(variety);
  if (e.key === a.key) {
    // Number words: the recogniser spells them with umlauts when it heard them ("fünf"); an
    // umlaut-less spelling ("funf", "zwolf") usually means the vowel came out as u / o.
    const lost = /^\d+$/.test(e.key) ? lostUmlauts(e.raw, a.raw) : null;
    return lost ? { kind: 'near', issues: lost } : { kind: 'exact' };
  }
  if ((a.key === '1' && isOneWord(e.raw, swiss)) || (e.key === '1' && isOneWord(a.raw, swiss))) return { kind: 'exact' };
  const issues = pronunciationIssues(e.raw, a.raw, variety);
  if (issues) return { kind: 'near', issues };
  const d = levenshtein(e.key, a.key, true);
  if (d <= Math.max(1, Math.floor(Math.max(e.key.length, a.key.length) / 3))) return { kind: 'similar' };
  return null;
}

type Op =
  | { op: 'pair'; i: number; j: number; m: NonNullable<Match> }
  | { op: 'merge'; i: number; j: number; ni: number; nj: number }
  | { op: 'miss'; i: number }
  | { op: 'extra'; j: number };

const W = { exact: 4, near: 3, similar: 1 } as const;

/** Best alignment (max weight) of target and transcript tokens, with compound merges. */
function align(exp: Tok[], act: Tok[], variety: Variety): Op[] {
  const swiss = isGsw(variety);
  const n = exp.length;
  const m = act.length;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const choice: Array<Array<Op | null>> = Array.from({ length: n + 1 }, () => new Array<Op | null>(m + 1).fill(null));
  const joinKey = (list: Tok[]) => keyOf(list.map((t) => t.raw).join(''), swiss);
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      if (i === n && j === m) continue;
      let v = -1;
      let c: Op | null = null;
      const take = (score: number, op: Op) => {
        if (score > v) {
          v = score;
          c = op;
        }
      };
      if (i < n && j < m) {
        const mt = matchWords(exp[i]!, act[j]!, variety);
        if (mt) take(W[mt.kind] + best[i + 1]![j + 1]!, { op: 'pair', i, j, m: mt });
        // Compound split by the recogniser: one target word = 2–3 transcript words, and the reverse.
        for (let k = 2; k <= 3; k++) {
          if (j + k <= m && joinKey(act.slice(j, j + k)) === exp[i]!.key) take(W.exact + 0.5 + best[i + 1]![j + k]!, { op: 'merge', i, j, ni: 1, nj: k });
          if (i + k <= n && joinKey(exp.slice(i, i + k)) === act[j]!.key) take(W.exact * k + best[i + k]![j + 1]!, { op: 'merge', i, j, ni: k, nj: 1 });
        }
      }
      if (i < n) take(best[i + 1]![j]!, { op: 'miss', i });
      if (j < m) take(best[i]![j + 1]!, { op: 'extra', j });
      best[i]![j] = v;
      choice[i]![j] = c;
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const c = choice[i]![j]!;
    ops.push(c);
    if (c.op === 'pair') { i++; j++; }
    else if (c.op === 'merge') { i += c.ni; j += c.nj; }
    else if (c.op === 'miss') i++;
    else j++;
  }
  return ops;
}

const quote = (s: string) => `“${s}”`;

/**
 * Grade a speech transcript against the target text. Returns a word diff (target surface forms;
 * `wrong` tokens carry `expected`, and `hint` when a pronunciation issue explains the
 * difference) and `hints`, one entry per issue with the affected words.
 */
export function gradeSpeech(target: string, transcript: string, opts: { variety?: Variety } = {}): GradeResult {
  const variety = opts.variety ?? 'de';
  const swiss = isGsw(variety);
  const exp = toks(target, swiss);
  const targetKeys = new Set(exp.map((t) => t.raw));
  const act = toks(transcript, swiss).filter((t) => targetKeys.has(t.raw) || !FILLERS.test(t.raw));

  const diff: DiffToken[] = [];
  const hintMap = new Map<PronunciationIssue, PronunciationHint>();
  let credit = 0;
  let pendMiss: Tok[] = [];
  let pendExtra: Tok[] = [];
  const flush = () => {
    const k = Math.min(pendMiss.length, pendExtra.length);
    for (let x = 0; x < k; x++) diff.push({ text: pendExtra[x]!.surface, kind: 'wrong', expected: pendMiss[x]!.surface });
    for (const t of pendMiss.slice(k)) diff.push({ text: t.surface, kind: 'missing' });
    for (const t of pendExtra.slice(k)) diff.push({ text: t.surface, kind: 'extra' });
    pendMiss = [];
    pendExtra = [];
  };
  for (const op of align(exp, act, variety)) {
    if (op.op === 'miss') { pendMiss.push(exp[op.i]!); continue; }
    if (op.op === 'extra') { pendExtra.push(act[op.j]!); continue; }
    if (op.op === 'pair' && op.m.kind === 'similar') {
      // A similar-sounding but different word: shown as wrong, no credit.
      flush();
      diff.push({ text: act[op.j]!.surface, kind: 'wrong', expected: exp[op.i]!.surface });
      continue;
    }
    flush();
    if (op.op === 'merge') {
      for (let x = 0; x < op.ni; x++) diff.push({ text: exp[op.i + x]!.surface, kind: 'same' });
      credit += op.ni;
      continue;
    }
    const e = exp[op.i]!;
    const a = act[op.j]!;
    if (op.m.kind === 'exact') {
      diff.push({ text: e.surface, kind: 'same' });
      credit += 1;
    } else if (op.m.kind === 'near') {
      diff.push({ text: a.surface, kind: 'wrong', expected: e.surface, hint: op.m.issues[0] });
      credit += SPEECH_NEAR_CREDIT;
      for (const id of op.m.issues) {
        const rule = RULE_BY_ID.get(id)!;
        const h = hintMap.get(id) ?? { id, label: rule.label, tip: rule.tip, words: [] };
        if (!h.words.some((w) => w.expected === e.surface && w.heard === a.surface)) h.words.push({ expected: e.surface, heard: a.surface });
        hintMap.set(id, h);
      }
    }
  }
  flush();

  const score = exp.length ? Math.min(1, credit / exp.length) : 0;
  const correct = exp.length > 0 && score >= SPEAK_PASS;
  const hints = PRONUNCIATION_RULES.map((r) => hintMap.get(r.id)).filter((h): h is PronunciationHint => Boolean(h));
  const practise = diff.filter((d) => d.kind === 'missing' || d.kind === 'wrong').map((d) => quote(d.expected ?? d.text));
  const feedback: string[] = [];
  if (!act.length) feedback.push('We did not hear anything. Check your microphone and try again.');
  else if (!practise.length) feedback.push('Every word was recognised.');
  else feedback.push(`${correct ? 'Good! ' : ''}Practise these words again: ${practise.slice(0, 5).join(', ')}${practise.length > 5 ? ' …' : ''}.`);
  for (const h of hints) {
    const ex = h.words.slice(0, 3).map((w) => `${quote(w.heard)} for ${quote(w.expected)}`).join(', ');
    feedback.push(`${h.label}: we heard ${ex}. ${h.tip}`);
  }
  const res: GradeResult = { correct, score, feedback, expected: target, diff };
  if (hints.length) res.hints = hints;
  return res;
}
