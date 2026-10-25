// Content contract shared by the app, the engine, the build tools and the books.
// Authors write YAML under content/<level>/unit-NN/; tools/ validates it with these
// schemas and compiles it into JSON level packs (LevelPack) that the app loads.
import { z } from 'zod';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const Level = z.enum(LEVELS);
export type Level = z.infer<typeof Level>;

export const SKILLS = ['reading', 'listening', 'speaking', 'writing', 'vocabulary', 'grammar'] as const;
export const Skill = z.enum(SKILLS);
export type Skill = z.infer<typeof Skill>;

/** de = German Standard German, ch-std = Swiss Standard German, gsw-zh / gsw-be = Zurich / Bernese dialect. */
export const VARIETIES = ['de', 'ch-std', 'gsw-zh', 'gsw-be'] as const;
export const Variety = z.enum(VARIETIES);
export type Variety = z.infer<typeof Variety>;

export const Gender = z.enum(['m', 'f', 'n']);
export type Gender = z.infer<typeof Gender>;

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');

/** Path relative to the unit folder, e.g. "audio/dialog-1.mp3". Optional until recorded. */
const audio = z.string().optional();

export const VocabItem = z.object({
  id,
  de: z.string(),
  en: z.string(),
  pos: z.enum(['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'phrase', 'other']),
  gender: Gender.optional(),
  /** Plural form; "-" means the noun has no plural (Milch, Schweiz). */
  plural: z.string().optional(),
  /** Plural-only nouns (die Eltern, die Geschwister): no gender, `de` is the plural form. */
  pluralOnly: z.boolean().optional(),
  example: z.object({ de: z.string(), en: z.string() }).optional(),
  /** Swiss Standard German variant (Helvetism), e.g. Velo for Fahrrad. */
  chStd: z.string().optional(),
  /** Zurich German form in Dieth-style spelling; alternatives separated by " / ". */
  gswZh: z.string().optional(),
  gswBe: z.string().optional(),
  audio,
  tags: z.array(z.string()).default([]),
});
export type VocabItem = z.infer<typeof VocabItem>;

const base = {
  id,
  skill: Skill,
  variety: Variety.default('de'),
  /** English instruction shown above the item. */
  prompt: z.string(),
  /** Explanation shown with the solution. Required: every exercise is solved and explained. */
  explanation: z.string().min(1),
  /** Grammar point ids this item practises; feeds the error profile. */
  grammar: z.array(z.string()).default([]),
  audio,
};

export const MultipleChoice = z.object({
  ...base,
  type: z.literal('mcq'),
  question: z.string().optional(),
  options: z.array(z.string()).min(2),
  answer: z.number().int().nonnegative(),
  /** Optional per-option reason, same order as options. */
  rationales: z.array(z.string()).optional(),
});

export const GapFill = z.object({
  ...base,
  type: z.literal('gap'),
  /** Text with gaps written as ___ (three underscores), one per entry in answers. */
  text: z.string(),
  /** answers[i] lists all accepted strings for gap i; the first is the model answer. */
  answers: z.array(z.array(z.string()).min(1)).min(1),
});

export const WordOrder = z.object({
  ...base,
  type: z.literal('order'),
  /** Tokens shown shuffled. */
  tokens: z.array(z.string()).min(2),
  /** Each accepted order as a full sentence; the first is the model answer. */
  answers: z.array(z.string()).min(1),
});

export const Match = z.object({
  ...base,
  type: z.literal('match'),
  pairs: z.array(z.tuple([z.string(), z.string()])).min(2),
});

export const Dictation = z.object({
  ...base,
  type: z.literal('dictation'),
  /** The text spoken in the audio (also used for TTS fallback when audio is missing). */
  transcript: z.string(),
});

export const Translate = z.object({
  ...base,
  type: z.literal('translate'),
  source: z.string(),
  /** Accepted translations; the first is the model answer. Unknown answers may go to AI grading. */
  answers: z.array(z.string()).min(1),
});

export const Transform = z.object({
  ...base,
  type: z.literal('transform'),
  /** e.g. Hochdeutsch -> Züritüütsch */
  from: Variety,
  to: Variety,
  source: z.string(),
  answers: z.array(z.string()).min(1),
});

export const Speak = z.object({
  ...base,
  type: z.literal('speak'),
  /** Text the learner reads aloud or shadows. */
  target: z.string(),
});

export const OpenWriting = z.object({
  ...base,
  type: z.literal('write'),
  task: z.string(),
  minWords: z.number().int().positive().optional(),
  /** Model answer shown as the solution. */
  model: z.string(),
  /** Self-assessment checklist used when no AI key is configured. */
  checklist: z.array(z.string()).min(1),
});

export const RolePlay = z.object({
  ...base,
  type: z.literal('roleplay'),
  scenario: z.string(),
  /** Goals the learner must reach in the conversation (CEFR can-do style). */
  goals: z.array(z.string()).min(1),
  tutor: z.enum(['lena', 'keller', 'reto', 'explainer']).default('lena'),
  /** Example dialogue shown as the solution. */
  model: z.string(),
});

export const Exercise = z.discriminatedUnion('type', [
  MultipleChoice, GapFill, WordOrder, Match, Dictation, Translate, Transform, Speak, OpenWriting, RolePlay,
]);
export type Exercise = z.infer<typeof Exercise>;
export type ExerciseType = Exercise['type'];

export const GrammarPoint = z.object({
  id,
  title: z.string(),
  /** Markdown, in English, with German examples. */
  body: z.string(),
  /** Optional tables: first row is the header. */
  tables: z.array(z.array(z.array(z.string()))).default([]),
  commonMistakes: z.array(z.string()).default([]),
});
export type GrammarPoint = z.infer<typeof GrammarPoint>;

export const DialogueLine = z.object({
  speaker: z.string(),
  text: z.string(),
  en: z.string(),
  variety: Variety.default('de'),
  audio,
});

export const Unit = z.object({
  id,                       // e.g. "a1-u01"
  level: Level,
  number: z.number().int().min(1).max(12),
  title: z.string(),        // German title
  titleEn: z.string(),
  goal: z.string(),         // "By the end you can ..."
  canDo: z.array(z.string()).min(1),
  intro: z.object({ scene: z.string(), dialogue: z.array(DialogueLine).min(1) }),
  grammar: z.array(GrammarPoint).min(1),
  reading: z.object({ title: z.string(), text: z.string(), en: z.string() }).optional(),
  /** The Swiss lane: same situation in dialect, plus notes on differences and Helvetisms. */
  swiss: z.object({
    scene: z.string(),
    dialogue: z.array(DialogueLine).min(1),
    notes: z.array(z.string()).min(1),
  }),
});
export type Unit = z.infer<typeof Unit>;

/** One unit as compiled by tools/ from unit.yaml + vocab.yaml + exercises.yaml. */
export const CompiledUnit = Unit.extend({
  vocab: z.array(VocabItem).min(1),
  exercises: z.array(Exercise).min(1),
});
export type CompiledUnit = z.infer<typeof CompiledUnit>;

export const LevelPack = z.object({
  level: Level,
  version: z.string(),
  builtAt: z.string(),
  units: z.array(CompiledUnit),
});
export type LevelPack = z.infer<typeof LevelPack>;

/** Index served at /packs/index.json listing available packs. */
export const PackIndex = z.object({
  packs: z.array(z.object({ level: Level, version: z.string(), file: z.string(), units: z.number().int() })),
});
export type PackIndex = z.infer<typeof PackIndex>;
