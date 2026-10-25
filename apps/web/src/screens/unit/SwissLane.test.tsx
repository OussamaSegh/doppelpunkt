import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompiledUnit } from '@doppelpunkt/content-schema';
import { fixtureUnit } from '../../test/fixtures';
import { ReviewNote } from '../UnitView';
import { SchwiizStep, swissLane } from './steps';

const zhExercise = {
  id: 'a1-u01-zh-1', type: 'mcq', skill: 'vocabulary', variety: 'gsw-zh', prompt: 'Zurich greeting?',
  options: ['Grüezi', 'Moin'], answer: 0, explanation: 'Grüezi is Swiss.',
} as const;
const beExercise = { ...zhExercise, id: 'a1-u01-be-1', variety: 'gsw-be', prompt: 'Bernese greeting?', options: ['Grüessech', 'Moin'], explanation: 'Grüessech is Bernese.' } as const;

const zhOnly = CompiledUnit.parse({ ...fixtureUnit, exercises: [...fixtureUnit.exercises, zhExercise] });
const both = CompiledUnit.parse({
  ...fixtureUnit,
  swiss: {
    ...fixtureUnit.swiss,
    dialogue: [
      { speaker: 'Anna', text: 'Hoi, ich bi d Anna.', en: 'Hi, I am Anna.', variety: 'gsw-zh' },
      { speaker: 'Anna', text: 'Hoi, i bi d Anna.', en: 'Hi, I am Anna.', variety: 'gsw-be' },
    ],
  },
  exercises: [...fixtureUnit.exercises, zhExercise, beExercise],
});

const renderLane = (unit: CompiledUnit, dialect: 'gsw-zh' | 'gsw-be') =>
  render(
    <MemoryRouter>
      <SchwiizStep unit={unit} dialect={dialect} />
    </MemoryRouter>,
  );

describe('Swiss lane dialect', () => {
  it('Bern: shows Bernese lines and exercises first when the unit has them', () => {
    const lane = swissLane(both, 'gsw-be');
    expect(lane.dialogue.map((l) => l.variety)).toEqual(['gsw-be']);
    expect(lane.exercises.map((e) => e.id)).toEqual(['a1-u01-be-1', 'a1-u01-zh-1']);
    expect(lane.dialogueFallback || lane.exerciseFallback).toBe(false);

    renderLane(both, 'gsw-be');
    expect(screen.getByText('Hoi, i bi d Anna.')).toBeInTheDocument();
    expect(screen.queryByText('Hoi, ich bi d Anna.')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByRole('heading', { level: 3 })).toHaveTextContent('Bernese greeting?');

    fireEvent.click(screen.getByRole('button', { name: 'Show the Zurich German version' }));
    expect(screen.getByText('Hoi, ich bi d Anna.')).toBeInTheDocument();
  });

  it('Bern: falls back to Zurich German with a short note', () => {
    renderLane(zhOnly, 'gsw-be');
    expect(screen.getByRole('note')).toHaveTextContent("This unit isn't written in Bernese German yet, so the Swiss lane uses Zurich German.");
    expect(screen.getByText('Hoi, ich bi d Anna.')).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByRole('img', { name: 'Zurich German' })).toBeInTheDocument();
  });

  it('Zurich: unchanged, no note', () => {
    renderLane(zhOnly, 'gsw-zh');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText('Hoi, ich bi d Anna.')).toBeInTheDocument();
  });
});

describe('ReviewNote', () => {
  it('flags units without both native sign-offs, subtly', () => {
    const { rerender } = render(<ReviewNote unit={{}} />);
    expect(screen.getByText(/Not yet reviewed by a native speaker/)).toBeInTheDocument();
    rerender(<ReviewNote unit={{ review: { de: 'A. Teacher', notes: [] } }} />);
    expect(screen.getByText(/Not yet reviewed by a native speaker \(Swiss German check pending\)/)).toBeInTheDocument();
    rerender(<ReviewNote unit={{ review: { de: 'A. Teacher', ch: 'B. Native', date: '2026-10-01', notes: [] } }} />);
    expect(screen.queryByText(/Not yet reviewed/)).not.toBeInTheDocument();
    expect(screen.getByText(/Checked by native speakers \(2026-10-01\)/)).toBeInTheDocument();
  });
});
