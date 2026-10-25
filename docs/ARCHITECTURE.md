# Architecture (v0.1)

Offline-first PWA. No Doppelpunkt server is needed for v0.x: content ships as static JSON packs,
progress lives in IndexedDB on the device, and AI calls go straight from the browser to the
provider the learner chose, using the learner's own key.

```
apps/web                 React 19 + Vite 7 + TypeScript PWA (vite-plugin-pwa, Tailwind 4, Dexie, Zustand)
packages/content-schema  zod schemas + types for units, vocab, exercises, packs (the content contract)
packages/engine          pure TS: graders, FSRS scheduling, CEFR estimator, error profile, placement
packages/ai              provider adapters (Anthropic, OpenAI, Gemini, xAI), tutor prompts, key vault
services/relay           optional stateless Cloudflare Worker that forwards AI calls (no storage)
content/                 YAML authored by language experts (content/<level>/unit-NN/*.yaml)
tools/                   content linter + pack builder -> apps/web/public/packs/*.json
docs/                    roadmap, content format, architecture
```

All workspace packages are consumed as TypeScript source (`main: src/index.ts`); Vite and Vitest
compile them. No package build step.

## Package contracts

### @doppelpunkt/engine

```ts
// grading
type GradeResult = { correct: boolean; score: number /*0..1*/; feedback: string[]; expected: string; diff?: DiffToken[] };
type DiffToken = { text: string; kind: 'same' | 'missing' | 'extra' | 'wrong' };
type Answer = number | string | string[] | Array<[string, string]>; // depends on exercise type
function normalize(s: string, opts?: { umlautFallback?: boolean; caseSensitive?: boolean }): string;
function grade(ex: Exercise, answer: Answer): GradeResult;            // closed types only
function needsAiGrading(ex: Exercise): boolean;                        // write, roleplay, unknown translate
function diffWords(expected: string, actual: string): DiffToken[];

// spaced repetition (wraps ts-fsrs)
type CardState = { id: string; due: string; stability: number; difficulty: number; reps: number; lapses: number; state: 0|1|2|3; last_review?: string; elapsed_days: number; scheduled_days: number; learning_steps: number };
type Rating = 'again' | 'hard' | 'good' | 'easy';
function newCard(id: string, now?: Date): CardState;
function review(card: CardState, rating: Rating, now?: Date): CardState;
function dueCards(cards: CardState[], now?: Date): CardState[];

// progress
type Attempt = { exerciseId: string; unitId: string; level: Level; skill: Skill; variety: Variety; score: number; grammar: string[]; errorTypes?: string[]; at: string };
type SkillEstimate = { skill: Skill | 'swiss'; band: string /* e.g. 'A2+' */; confidence: number; attempts: number };
function estimateSkills(attempts: Attempt[]): SkillEstimate[];
function errorProfile(attempts: Attempt[]): Array<{ key: string; count: number }>;
function unitProgress(unit: CompiledUnit, attempts: Attempt[]): { done: number; total: number; avgScore: number };

// placement
function placementItems(packs: LevelPack[], n?: number): Exercise[];
function placeLearner(results: Array<{ level: Level; score: number }>): { level: Level; unit: number };
```

### @doppelpunkt/ai

```ts
type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'xai';
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type ProviderConfig = { id: ProviderId; apiKey: string; model: string; relayUrl?: string };
interface Provider {
  id: ProviderId;
  chat(msgs: ChatMessage[], opts?: { maxTokens?: number; signal?: AbortSignal }): Promise<{ text: string; usage: Usage }>;
  stream(msgs: ChatMessage[], opts?: {...}): AsyncIterable<string>;
  structured<T>(msgs: ChatMessage[], schema: ZodType<T>, opts?): Promise<{ data: T; usage: Usage }>;
  transcribe?(audio: Blob, lang: 'de' | 'gsw'): Promise<string>;  // openai, gemini
}
function createProvider(cfg: ProviderConfig, fetchImpl?: typeof fetch): Provider;
const DEFAULT_MODELS: Record<ProviderId, string[]>;
// tutors
type TutorId = 'lena' | 'keller' | 'reto' | 'explainer';
function tutorSystemPrompt(tutor: TutorId, ctx: { level: Level; unit?: CompiledUnit; dialect?: 'gsw-zh' | 'gsw-be' }): string;
const WritingFeedback: ZodType<{ corrected: string; errors: {type: string; original: string; correction: string; explanation: string}[]; scores: Record<string, number>; focusNext: string }>;
function gradeWriting(p: Provider, ex: OpenWriting, text: string, level: Level): Promise<WritingFeedback>;
function explain(p: Provider, ex: Exercise, answer: string, level: Level): Promise<string>;
// keys + cost
function encryptKey(apiKey: string, passphrase: string): Promise<string>; // AES-GCM + PBKDF2, base64 payload
function decryptKey(payload: string, passphrase: string): Promise<string>;
function estimateCost(provider: ProviderId, model: string, usage: Usage): number; // USD, approximate
```

## Implemented extensions (v0.1)

The packages implement the contract above plus additive extras; the source is the reference
(`packages/*/src/index.ts`). Notable ones:

- engine: `GradeResult.parts` (per gap/pair) and `needsAi`; write/roleplay return `needsAi` instead of
  throwing; `errorProfile` items carry `kind: 'grammar' | 'error'` with weighted counts; `streak`,
  `weeklyMinutes`; `placementItems` returns items tagged with `level` and `unitId`.
- Placement rule: a level passes at ≥70%, walking up from A1. Nobody passes → A1 unit 1. Highest
  passed level ≥90% → next level unit 1. Otherwise unit = 1 + ⌊(score − 0.7) / 0.2 × 12⌋ in that level.
- ai: `Provider.model`, `onUsage` on streams, `temperature`, `AiError` kinds (`cors` suggests the relay),
  `generatePractice` (closed types only, ids `ai-…`), `TUTOR_INFO`, `PROVIDER_LABELS`, `PROVIDER_KEY_URLS`.
  Writing scores are 0–5 per criterion.
- Content: `pluralOnly: true` for plural-only nouns, `plural: "-"` for nouns without a plural.
