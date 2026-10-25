import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../db';
import { fixtureUnit } from '../../test/fixtures';
import { sessionStats, wordsInExercises, recordOutcome } from '../../lib/practice';
import { ExerciseRunner } from './ExerciseRunner';

beforeEach(async () => {
  await db.attempts.clear();
  await db.cards.clear();
  await db.unitStatus.clear();
});

const exercises = fixtureUnit.exercises;

function renderRunner(path = '/unit/a1-u01/uebungen') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ExerciseRunner unit={fixtureUnit} exercises={exercises} label="Exercises" />
    </MemoryRouter>,
  );
}

describe('ExerciseRunner', () => {
  it('offers a retry only for wrong answers and scores the session by first attempts', async () => {
    renderRunner();
    // Item 1 (mcq): wrong, then right on retry.
    fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('radio', { name: 'bin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Richtig!');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    // Item 2 (gap): right first time.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'bist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Richtig!');

    // Item 3 is the last: Finish opens the summary (Enter would too).
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    const summary = screen.getByRole('region', { name: 'Session summary' });
    expect(summary).toHaveTextContent('2 of 3 items answered');
    expect(summary).toHaveTextContent('50%'); // (0 + 1) / 2, not the retry's 100%
    expect(summary).toHaveTextContent('1 / 2');
    const mistakes = within(summary).getByRole('list', { name: 'Mistakes to review' });
    expect(within(mistakes).getAllByRole('listitem')).toHaveLength(1);
    expect(within(mistakes).getByRole('link', { name: 'Practise item 1 again' })).toHaveAttribute('href', '/unit/a1-u01/uebungen?item=a1-u01-mcq-1');
    expect(within(summary).getByRole('list', { name: 'Score by skill' })).toHaveTextContent('Grammar');

    // Both attempts are still saved to progress (best score 100%).
    await waitFor(async () => expect(await db.attempts.count()).toBe(3));
  });

  it('adds the words from missed items to the review deck', async () => {
    const nameGap = { ...exercises[1]!, id: 'a1-u01-gap-name', type: 'gap' as const, text: 'Mein ___ ist Ben.', answers: [['Name']] };
    render(
      <MemoryRouter>
        <ExerciseRunner unit={fixtureUnit} exercises={[nameGap]} label="Exercises" />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'Hund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Not quite');
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    const add = screen.getByRole('button', { name: 'Add missed words to review' });
    fireEvent.click(add);
    expect(await screen.findByRole('status')).toHaveTextContent('Added 1 word to your review deck.');
    expect((await db.cards.toArray()).map((c) => c.id)).toEqual(['name']);
    expect(add).toBeDisabled();
  });

  it('opens the item named in ?item=', () => {
    renderRunner('/unit/a1-u01/uebungen?item=a1-u01-order-1');
    expect(screen.getByRole('button', { name: 'Item 3' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { level: 3, name: 'Put the words in order.' })).toBeInTheDocument();
  });

  it('jumps back to a mistake from the summary', async () => {
    renderRunner();
    fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Not quite');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    fireEvent.click(screen.getByRole('link', { name: 'Practise item 1 again' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Choose the right form.' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Session summary' })).not.toBeInTheDocument();
  });
});

describe('practice helpers', () => {
  it('keeps the first attempt and counts tries', () => {
    let s = recordOutcome({}, { exerciseId: 'a1-u01-gap-1', score: 0.7, correct: false });
    s = recordOutcome(s, { exerciseId: 'a1-u01-gap-1', score: 1, correct: true });
    expect(s['a1-u01-gap-1']).toMatchObject({ tries: 2, first: { score: 0.7 }, last: { score: 1 } });
    const stats = sessionStats(exercises, s);
    expect(stats).toMatchObject({ answered: 1, total: 3, score: 0.7, rightFirstTime: 0 });
    expect(stats.mistakes.map((e) => e.id)).toEqual(['a1-u01-gap-1']);
  });

  it('finds unit words (and Swiss forms) in exercises', () => {
    const withWords = [{ ...exercises[1]!, type: 'gap' as const, text: 'Mein ___ ist Ben. Hoi!', answers: [['Name']] }];
    expect(wordsInExercises(fixtureUnit, withWords).map((v) => v.id).sort()).toEqual(['hallo', 'name']);
  });
});
