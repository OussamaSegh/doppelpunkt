import { describe, expect, it } from 'vitest';
import { studyStreak as streak, weekMinutes } from './progress';
import { todayKey } from '../db';

describe('streak', () => {
  const now = new Date(2026, 9, 25, 12);
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return todayKey(d);
  };

  it('counts consecutive days ending today', () => {
    expect(streak([{ day: day(0), seconds: 60 }, { day: day(1), seconds: 30 }, { day: day(3), seconds: 30 }], [], now)).toBe(2);
  });

  it('keeps yesterday\'s streak alive before today\'s first session', () => {
    expect(streak([{ day: day(1), seconds: 60 }, { day: day(2), seconds: 60 }], [], now)).toBe(2);
  });

  it('is zero without activity', () => {
    expect(streak([], [], now)).toBe(0);
  });
});

describe('weekMinutes', () => {
  it('returns seven days, oldest first', () => {
    const now = new Date(2026, 9, 25, 12);
    const w = weekMinutes([{ day: todayKey(now), seconds: 600 }], now);
    expect(w).toHaveLength(7);
    expect(w[6]?.minutes).toBe(10);
  });
});
