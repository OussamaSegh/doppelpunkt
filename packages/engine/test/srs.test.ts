import { describe, expect, it } from 'vitest';
import { dueCards, newCard, ratingFromScore, review, type CardState } from '../src';

const now = new Date('2026-01-10T09:00:00.000Z');
const later = (card: CardState, days: number) => new Date(Date.parse(card.due) + days * 86_400_000);

describe('srs', () => {
  it('creates a plain-JSON new card that is due now', () => {
    const c = newCard('v-hallo', now);
    expect(c).toMatchObject({ id: 'v-hallo', due: now.toISOString(), state: 0, reps: 0, lapses: 0 });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(c.last_review).toBeUndefined();
  });
  it('schedules further out for better ratings', () => {
    const c = newCard('a', now);
    const again = review(c, 'again', now);
    const good = review(c, 'good', now);
    const easy = review(c, 'easy', now);
    expect(Date.parse(again.due)).toBeLessThanOrEqual(Date.parse(good.due));
    expect(Date.parse(good.due)).toBeLessThan(Date.parse(easy.due));
    expect(good.reps).toBe(1);
    expect(good.last_review).toBe(now.toISOString());
    expect(typeof good.due).toBe('string');
    expect(c.reps).toBe(0); // input not mutated
  });
  it('graduates to review state and grows intervals', () => {
    let c = newCard('b', now);
    let t = now;
    for (let i = 0; i < 4; i++) {
      c = review(c, 'good', t);
      t = later(c, 0);
    }
    expect(c.state).toBe(2);
    const before = c.scheduled_days;
    const next = review(c, 'good', later(c, 0));
    expect(next.scheduled_days).toBeGreaterThan(before);
  });
  it('counts lapses after forgetting a review card', () => {
    let c = newCard('c', now);
    c = review(c, 'easy', now);
    expect(c.state).toBe(2);
    const lapsed = review(c, 'again', later(c, 0));
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.state).toBe(3);
  });
  it('round-trips through JSON without losing scheduling', () => {
    const c = review(newCard('d', now), 'good', now);
    const restored = JSON.parse(JSON.stringify(c)) as CardState;
    expect(review(restored, 'good', later(c, 0))).toEqual(review(c, 'good', later(c, 0)));
  });
  it('returns due cards, most overdue first', () => {
    const a = { ...newCard('a', now), due: '2026-01-09T00:00:00.000Z' };
    const b = { ...newCard('b', now), due: '2026-01-05T00:00:00.000Z' };
    const c = { ...newCard('c', now), due: '2026-02-01T00:00:00.000Z' };
    expect(dueCards([a, b, c], now).map((x) => x.id)).toEqual(['b', 'a']);
  });
  it('maps scores to ratings', () => {
    expect(ratingFromScore(1)).toBe('good');
    expect(ratingFromScore(0.7)).toBe('hard');
    expect(ratingFromScore(0.2)).toBe('again');
  });
});
