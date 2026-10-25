import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db';
import { exercise, fixtureUnit } from '../test/fixtures';
import { ExercisePlayer } from './ExercisePlayer';

beforeEach(async () => {
  await db.attempts.clear();
  await db.unitStatus.clear();
});

describe('ExercisePlayer — mcq', () => {
  it('grades a correct choice, records the attempt and shows the explanation', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} onDone={onDone} />);

    const check = screen.getByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'bin' }));
    expect(check).toBeEnabled();
    fireEvent.click(check);

    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    expect(screen.getByText('With ich, sein becomes bin.')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: 'a1-u01-mcq-1', correct: true, score: 1 }));
    await waitFor(async () => expect(await db.attempts.count()).toBe(1));
    const [attempt] = await db.attempts.toArray();
    expect(attempt).toMatchObject({ unitId: 'a1-u01', level: 'A1', skill: 'grammar', score: 1 });
  });

  it('shows the solution for a wrong choice', async () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Not quite')).toBeInTheDocument();
    expect(screen.getByText('Solution')).toBeInTheDocument();
  });
});

describe('ExercisePlayer — gap', () => {
  it('accepts the right word', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'bist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: true }));
  });

  it('marks a wrong word and shows the model answer', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'bin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: false })));
    expect(screen.getByText('Solution')).toBeInTheDocument();
    expect(screen.getByText('With du, sein becomes bist.')).toBeInTheDocument();
  });

  it('does not record attempts when record is off (placement test)', async () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} record={false} showFeedback={false} />);
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'bist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Answer saved.')).toBeInTheDocument();
    expect(await db.attempts.count()).toBe(0);
  });
});

describe('ExercisePlayer — order', () => {
  it('builds the sentence by tapping tokens', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-order-1')} unit={fixtureUnit} onDone={onDone} />);
    for (const w of ['Ich', 'heiße', 'Ben']) fireEvent.click(screen.getByRole('button', { name: w }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: true }));
  });
});
