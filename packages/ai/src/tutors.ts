import {
  Exercise,
  GapFill,
  MultipleChoice,
  Translate,
  WordOrder,
  type GrammarPoint,
  type Level,
  type OpenWriting,
} from '@doppelpunkt/content-schema';
import { z } from 'zod';
import { LEVEL_PROFILE, tutorSystemPrompt, type TutorContext } from './prompts';
import type { Provider } from './types';

type OpenWritingT = z.infer<typeof OpenWriting>;
export type { OpenWritingT as OpenWriting };

export const WRITING_CRITERIA = ['task', 'coherence', 'vocabulary', 'grammar'] as const;

const score = z.number().min(0).max(5);

export const WritingFeedback = z.object({
  corrected: z.string().describe('the learner text with minimal corrections'),
  errors: z.array(z.object({
    type: z.string().describe('error type, e.g. word order, case, gender, verb, spelling, vocabulary'),
    original: z.string(),
    correction: z.string(),
    explanation: z.string().describe('short plain-English explanation'),
  })),
  scores: z.record(score).describe('keys: task, coherence, vocabulary, grammar; each 0-5'),
  focusNext: z.string().describe('one concrete thing to practise next, in English'),
});
export type WritingFeedback = z.infer<typeof WritingFeedback>;

const WRITING_DESCRIPTION = `{
  "corrected": string /* the learner's text with minimal corrections */,
  "errors": Array<{ "type": string /* e.g. "word order", "case", "gender", "verb", "spelling", "vocabulary" */, "original": string, "correction": string, "explanation": string /* plain English */ }>,
  "scores": { "task": number, "coherence": number, "vocabulary": number, "grammar": number } /* each 0-5 */,
  "focusNext": string /* one concrete thing to practise next, in English */
}`;

/** Grades free writing with the Keller rubric. */
export async function gradeWriting(p: Provider, ex: OpenWritingT, text: string, level: Level, ctx: Omit<TutorContext, 'level'> = {}): Promise<WritingFeedback> {
  const task = [
    `Task: ${ex.task}`,
    ex.minWords ? `Minimum length: ${ex.minWords} words.` : '',
    `Checklist: ${ex.checklist.join('; ')}`,
    `Model answer (for reference only, do not expect the same text):\n${ex.model}`,
    '',
    `Learner's text:\n"""\n${text}\n"""`,
  ].filter(Boolean).join('\n');
  const { data } = await p.structured(
    [
      { role: 'system', content: tutorSystemPrompt('keller', { ...ctx, level }) },
      { role: 'user', content: task },
    ],
    WritingFeedback,
    { schemaDescription: WRITING_DESCRIPTION, temperature: 0.2 },
  );
  // Clamp and fill missing criteria so the UI can always render four bars.
  const scores: Record<string, number> = {};
  for (const k of WRITING_CRITERIA) scores[k] = Math.max(0, Math.min(5, Math.round(data.scores[k] ?? 0)));
  for (const [k, v] of Object.entries(data.scores)) if (!(k in scores)) scores[k] = v;
  return { ...data, scores };
}

/** The stored solution of an exercise, as text for prompts. */
export function solutionText(ex: Exercise): string {
  switch (ex.type) {
    case 'mcq': return ex.options[ex.answer] ?? '';
    case 'gap': return ex.answers.map((a, i) => `gap ${i + 1}: ${a.join(' / ')}`).join('; ');
    case 'order': case 'translate': case 'transform': return ex.answers.join(' / ');
    case 'match': return ex.pairs.map(([a, b]) => `${a} = ${b}`).join('; ');
    case 'dictation': return ex.transcript;
    case 'speak': return ex.target;
    case 'write': case 'roleplay': return ex.model;
  }
}

function exerciseText(ex: Exercise): string {
  const lines = [`Exercise type: ${ex.type} (variety: ${ex.variety})`, `Instruction: ${ex.prompt}`];
  switch (ex.type) {
    case 'mcq': if (ex.question) lines.push(`Question: ${ex.question}`); lines.push(`Options: ${ex.options.map((o, i) => `${i + 1}) ${o}`).join('  ')}`); break;
    case 'gap': lines.push(`Text: ${ex.text}`); break;
    case 'order': lines.push(`Words: ${ex.tokens.join(' | ')}`); break;
    case 'translate': case 'transform': lines.push(`Source: ${ex.source}`); break;
    case 'match': break;
    case 'write': lines.push(`Task: ${ex.task}`); break;
    case 'roleplay': lines.push(`Scenario: ${ex.scenario}`); break;
    default: break;
  }
  lines.push(`Correct answer: ${solutionText(ex)}`, `Teacher's note: ${ex.explanation}`);
  return lines.join('\n');
}

/** Plain-English explanation of why the learner's answer is right or wrong. */
export async function explain(p: Provider, ex: Exercise, answer: string, level: Level, ctx: Omit<TutorContext, 'level'> = {}): Promise<string> {
  const { text } = await p.chat([
    { role: 'system', content: tutorSystemPrompt('explainer', { ...ctx, level }) },
    { role: 'user', content: `${exerciseText(ex)}\n\nLearner's answer: ${answer || '(no answer)'}\n\nExplain.` },
  ], { maxTokens: 600 });
  return text.trim();
}

// ---- AI practice generation -------------------------------------------------------------------

// The model does not write ids; a placeholder satisfies the schema until real ids are assigned.
const GeneratedItem = z.preprocess(
  (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v, id: 'ai-tmp' } : v),
  z.discriminatedUnion('type', [MultipleChoice, GapFill, WordOrder, Translate]).superRefine((ex, ctx) => {
    if (ex.type === 'mcq' && ex.answer >= ex.options.length) ctx.addIssue({ code: 'custom', path: ['answer'], message: 'answer must be a valid 0-based option index' });
    if (ex.type === 'gap') {
      const gaps = (ex.text.match(/___/g) ?? []).length;
      if (gaps !== ex.answers.length) ctx.addIssue({ code: 'custom', path: ['answers'], message: `text has ${gaps} gaps (___) but answers has ${ex.answers.length} entries` });
    }
  }),
);
const GeneratedSet = z.object({ items: z.array(GeneratedItem).min(1) });
type GeneratedSet = z.output<typeof GeneratedSet>;

const PRACTICE_DESCRIPTION = `{ "items": Array<
  | { "type": "mcq", "skill": "grammar", "prompt": string /* English instruction */, "question": string, "options": string[] /* 3-4 */, "answer": integer /* 0-based index */, "explanation": string /* English */ }
  | { "type": "gap", "skill": "grammar", "prompt": string, "text": string /* German, each gap written as ___ */, "answers": string[][] /* one list of accepted answers per gap */, "explanation": string }
  | { "type": "order", "skill": "grammar", "prompt": string, "tokens": string[] /* words of the sentence, shuffled */, "answers": string[] /* accepted full sentences */, "explanation": string }
  | { "type": "translate", "skill": "grammar", "prompt": string, "source": string /* English */, "answers": string[] /* accepted German translations */, "explanation": string }
> }`;

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
}

/**
 * Generates n closed practice items (mcq, gap, order, translate) for a grammar point. Items are
 * validated against the content-schema Exercise schema, tagged with the grammar point, and get ids
 * starting with "ai-" so the app can tell them apart from authored content.
 */
export async function generatePractice(p: Provider, grammarPoint: GrammarPoint | string, level: Level, n = 5): Promise<Exercise[]> {
  const gp = typeof grammarPoint === 'string' ? { id: slug(grammarPoint), title: grammarPoint, body: '', commonMistakes: [] as string[] } : grammarPoint;
  const count = Math.max(1, Math.min(20, Math.floor(n)));
  const user = [
    `Write ${count} new practice items for the German grammar point "${gp.title}" at CEFR ${level}.`,
    gp.body ? `Grammar notes:\n${gp.body.slice(0, 2000)}` : '',
    gp.commonMistakes.length ? `Common mistakes to target: ${gp.commonMistakes.join('; ')}` : '',
    `Learner level: ${LEVEL_PROFILE[level]}`,
    'Rules: Standard German (de) only. Mix the item types. Every item must have exactly one clearly correct answer (list accepted alternatives).',
    'Instructions ("prompt") and "explanation" are in English; German sentences use only vocabulary appropriate for the level.',
    'For "gap", the number of ___ in "text" must equal the length of "answers". For "mcq", "answer" is the 0-based index of the correct option.',
  ].filter(Boolean).join('\n');
  const { data } = await p.structured(
    [
      { role: 'system', content: 'You are an expert author of German exercises for English-speaking learners. Your German is flawless.' },
      { role: 'user', content: user },
    ],
    GeneratedSet,
    { schemaDescription: PRACTICE_DESCRIPTION, maxTokens: 4096, temperature: 0.7 },
  );
  const stamp = Date.now().toString(36);
  return data.items.slice(0, count).map((item, i) => {
    const grammar = item.grammar.includes(gp.id) ? item.grammar : [gp.id, ...item.grammar];
    return Exercise.parse({ ...item, id: `ai-${slug(gp.id)}-${stamp}-${i + 1}`, variety: 'de', grammar });
  });
}
