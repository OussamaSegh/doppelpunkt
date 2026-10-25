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
  example: z.object({ de: z.string(), en: z.string(), audio }).optional(),
  /** Swiss Standard German variant (Helvetism), e.g. Velo for Fahrrad. */
  chStd: z.string().optional(),
  /** Zurich German form in Dieth-style spelling; alternatives separated by " / ". */
  gswZh: z.string().optional(),
  gswBe: z.string().optional(),
  audio,
  /** Recording of the Zurich / Bernese form. */
  gswZhAudio: audio,
  gswBeAudio: audio,
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

/** Native-speaker sign-off. A unit ships to learners in v1.0+ only when both reviews are present. */
export const Review = z.object({
  /** German native teacher who checked the Standard German. */
  de: z.string().optional(),
  /** Swiss native who checked every Swiss lane item and Helvetism. */
  ch: z.string().optional(),
  /** ISO date of the last sign-off. */
  date: z.string().optional(),
  /** Open questions for the reviewer. */
  notes: z.array(z.string()).default([]),
});
export type Review = z.infer<typeof Review>;

export const Unit = z.object({
  id,                       // e.g. "a1-u01"
  review: Review.optional(),
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
  /** Mock exams for the level (v0.4+). */
  exams: z.array(z.lazy(() => MockExam)).default([]),
});
export type LevelPack = z.infer<typeof LevelPack>;

/** Index served at /packs/index.json listing available packs. */
export const PackIndex = z.object({
  packs: z.array(z.object({ level: Level, version: z.string(), file: z.string(), units: z.number().int() })),
});
export type PackIndex = z.infer<typeof PackIndex>;

/**
 * Pronunciation drill (content/pronunciation/<id>.yaml). One sound or contrast per drill:
 * the learner hears and repeats minimal pairs, then words and a sentence, and the speaking
 * grader compares the transcript with the target.
 */
export const PronunciationDrill = z.object({
  id,
  /** e.g. "ü vs u", "ich-Laut vs ach-Laut", "Swiss ch". */
  title: z.string(),
  /** IPA symbols involved, e.g. ["y", "u"]. */
  ipa: z.array(z.string()).default([]),
  level: Level.default('A1'),
  variety: Variety.default('de'),
  /** Markdown in English: how to make the sound, compared with English. */
  explanation: z.string().min(1),
  tips: z.array(z.string()).default([]),
  /** Minimal pairs [a, b] with English glosses, e.g. [["Mütter", "mothers"], ["Mutter", "mother"]]. */
  pairs: z.array(z.tuple([
    z.object({ text: z.string(), en: z.string(), audio }),
    z.object({ text: z.string(), en: z.string(), audio }),
  ])).default([]),
  words: z.array(z.object({ text: z.string(), en: z.string(), audio })).min(1),
  sentences: z.array(z.object({ text: z.string(), en: z.string(), audio })).default([]),
  /** Typical mistakes of English speakers, shown as feedback. */
  commonMistakes: z.array(z.string()).default([]),
});
export type PronunciationDrill = z.infer<typeof PronunciationDrill>;

/** Served at /packs/pronunciation.json. */
export const PronunciationPack = z.object({
  version: z.string(),
  builtAt: z.string(),
  drills: z.array(PronunciationDrill),
});
export type PronunciationPack = z.infer<typeof PronunciationPack>;

/**
 * Mock exam (content/<level>/exam/<id>.yaml): original items in the format of the
 * Goethe / telc / ÖSD papers for that level. Never copy publishers' items.
 */
export const ExamSection = z.object({
  id,
  /** Hören, Lesen, Schreiben, Sprechen. */
  skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
  title: z.string(),
  minutes: z.number().int().positive(),
  /** Markdown instructions in English (with the German rubric line as in real papers). */
  instructions: z.string(),
  /** Optional shared stimulus (text or transcript) for the section's items. */
  stimulus: z.object({ title: z.string().optional(), text: z.string(), variety: Variety.default('de'), audio }).optional(),
  exercises: z.array(Exercise).min(1),
  /** Points per exercise; defaults to 1 each. Open tasks are scored 0–maxPoints by AI or self-assessment. */
  points: z.array(z.number().nonnegative()).optional(),
});
export type ExamSection = z.infer<typeof ExamSection>;

export const MockExam = z.object({
  id,
  level: Level,
  title: z.string(),
  /** Which exam family the format follows, for orientation only. */
  format: z.enum(['goethe', 'telc', 'osd', 'generic']).default('generic'),
  /** Fraction of total points needed to pass, e.g. 0.6. */
  passMark: z.number().min(0).max(1).default(0.6),
  sections: z.array(ExamSection).min(1),
});
export type MockExam = z.infer<typeof MockExam>;
