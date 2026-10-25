// Spaced repetition: a thin, JSON-friendly wrapper around ts-fsrs (FSRS v5/6 scheduler).
import { createEmptyCard, fsrs, Rating as FsrsRating, type Card, type FSRSParameters, type Grade } from 'ts-fsrs';

/** Plain-JSON card state (ISO date strings) so it can be stored in IndexedDB as is. */
export type CardState = {
  id: string;
  /** ISO date-time when the card is next due. */
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  state: 0 | 1 | 2 | 3;
  last_review?: string;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
};

export type Rating = 'again' | 'hard' | 'good' | 'easy';

const RATING: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

let scheduler = fsrs({ enable_fuzz: false, request_retention: 0.9 });

/** Override scheduler parameters (e.g. desired retention). Fuzz is off by default for predictable tests. */
export function configureScheduler(params: Partial<FSRSParameters>): void {
  scheduler = fsrs({ enable_fuzz: false, request_retention: 0.9, ...params });
}

function toJson(id: string, c: Card): CardState {
  const out: CardState = {
    id,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as 0 | 1 | 2 | 3,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
  };
  if (c.last_review) out.last_review = c.last_review.toISOString();
  return out;
}

function fromJson(s: CardState): Card {
  const card: Card = {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps ?? 0,
  };
  if (s.last_review) card.last_review = new Date(s.last_review);
  return card;
}

/** A brand-new card, due immediately. */
export function newCard(id: string, now: Date = new Date()): CardState {
  return toJson(id, createEmptyCard(now));
}

/** Apply a rating and return the next state (the input is not mutated). */
export function review(card: CardState, rating: Rating, now: Date = new Date()): CardState {
  const next = scheduler.next(fromJson(card), now, RATING[rating]);
  return toJson(card.id, next.card);
}

/** Cards due at `now`, most overdue first. */
export function dueCards(cards: CardState[], now: Date = new Date()): CardState[] {
  const t = now.getTime();
  return cards
    .filter((c) => Date.parse(c.due) <= t)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id));
}

/** Map a grader score (0..1) to an FSRS rating, for exercises reviewed as cards. */
export function ratingFromScore(score: number): Rating {
  if (score >= 0.999) return 'good';
  if (score >= 0.7) return 'hard';
  return 'again';
}
