// Editorial rules for a single exercise, shared by units (lint.ts) and mock exams (exam.ts).
import type { Exercise } from '@doppelpunkt/content-schema';
import { grade, normalize, sentenceKey, type Answer } from '@doppelpunkt/engine';
import { quoted } from './audio';
import type { Issue } from './load';

/** Count of gap markers. A gap is exactly three underscores. */
export function countGaps(text: string): number {
  return (text.match(/___/g) ?? []).length;
}

const words = (s: string) => sentenceKey(s).split(' ').filter(Boolean).sort().join(' ');

/** Answers that the grader must accept for an exercise (self-check of the stored solution). */
export function modelAnswers(ex: Exercise): Answer[] {
  switch (ex.type) {
    case 'mcq': return [ex.answer];
    case 'gap': return [ex.answers.map((a) => a[0] ?? '')];
    case 'order': return ex.answers;
    case 'match': return [ex.pairs];
    case 'dictation': return [ex.transcript];
    case 'translate':
    case 'transform': return ex.answers;
    case 'speak': return [ex.target];
    case 'write':
    case 'roleplay': return [];
  }
}

export function exerciseRules(ex: Exercise, where: string, file: string, push: (s: Issue['severity'], f: string, m: string) => void) {
  const at = `${where} (id: ${ex.id})`;
  switch (ex.type) {
    case 'gap': {
      const n = countGaps(ex.text);
      if (/_{4,}/.test(ex.text)) push('error', file, `${at}: write gaps as exactly three underscores (___)`);
      if (n !== ex.answers.length) push('error', file, `${at}: text has ${n} gap(s) (___) but answers has ${ex.answers.length} entr${ex.answers.length === 1 ? 'y' : 'ies'}`);
      ex.answers.forEach((a, i) => {
        if (a.some((s) => !s.trim())) push('error', file, `${at}: answers[${i}] contains an empty string`);
      });
      break;
    }
    case 'mcq':
      if (ex.answer >= ex.options.length) push('error', file, `${at}: answer index ${ex.answer} is out of range (${ex.options.length} options, indexes 0-${ex.options.length - 1})`);
      if (ex.rationales && ex.rationales.length !== ex.options.length) push('warning', file, `${at}: rationales has ${ex.rationales.length} entries but there are ${ex.options.length} options`);
      if (new Set(ex.options.map((o) => normalize(o, { caseSensitive: true }))).size !== ex.options.length) push('error', file, `${at}: options contain duplicates`);
      break;
    case 'order': {
      const expected = words(ex.tokens.join(' '));
      ex.answers.forEach((a, i) => {
        if (words(a) !== expected) push('error', file, `${at}: answers[${i}] "${a}" does not use exactly the tokens [${ex.tokens.join(' | ')}]`);
      });
      break;
    }
    case 'match': {
      const left = ex.pairs.map(([l]) => sentenceKey(l));
      const right = ex.pairs.map(([, r]) => sentenceKey(r));
      if (new Set(left).size !== left.length) push('error', file, `${at}: left-hand items must be unique`);
      if (new Set(right).size !== right.length) push('error', file, `${at}: right-hand items must be unique`);
      break;
    }
    case 'transform':
    case 'translate':
    case 'dictation':
    case 'speak':
    case 'write':
    case 'roleplay':
      break;
  }
  if ('answers' in ex && Array.isArray(ex.answers) && ex.type !== 'gap') {
    (ex.answers as string[]).forEach((a, i) => {
      if (!a.trim()) push('error', file, `${at}: answers[${i}] is empty`);
    });
  }
  // The stored solution must be accepted by the grader.
  for (const ans of modelAnswers(ex)) {
    let res;
    try {
      res = grade(ex, ans);
    } catch (e) {
      push('error', file, `${at}: grader crashed on the model answer: ${(e as Error).message}`);
      continue;
    }
    if (!res.correct) push('error', file, `${at}: the grader rejects the model answer ${JSON.stringify(ans)} (score ${res.score.toFixed(2)})`);
  }
}


/** Item types that play something to the learner in a listening task (dictation has its own transcript). */
const HEARD = new Set<Exercise['type']>(['mcq', 'gap', 'order', 'match', 'translate', 'transform']);

/**
 * A listening item must have something to hear: its own `audio` or `transcript`, or a shared stimulus
 * (the section stimulus in an exam; the unit's dialogues when the prompt says "Listen to the … dialogue").
 * Text quoted in the prompt is shown on screen, which turns listening into reading.
 */
export function listeningRules(ex: Exercise, stimulus: boolean, where: string, file: string, push: (s: Issue['severity'], f: string, m: string) => void) {
  if (ex.skill !== 'listening' || !HEARD.has(ex.type)) return;
  const at = `${where} (id: ${ex.id})`;
  if (!ex.transcript && quoted(ex.prompt)) {
    push('warning', file, `${at}: listening item quotes what is said in its prompt (shown on screen); move it to transcript: and keep a short question`);
  } else if (!ex.audio && !ex.transcript?.trim() && !stimulus) {
    push('warning', file, `${at}: listening item has no audio, no transcript and no stimulus; there is nothing to hear`);
  }
}
