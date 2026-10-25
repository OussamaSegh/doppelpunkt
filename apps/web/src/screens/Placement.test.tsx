import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CompiledUnit, type LevelPack } from '@doppelpunkt/content-schema';
import { useContent } from '../content';
import { db, getSettings, type PlacementResult } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { explainPlacement, levelScores, verdicts } from '../lib/placement';
import { Placement, PlacementResults } from './Placement';

const unit2 = CompiledUnit.parse({ ...fixtureUnit, id: 'a1-u02', number: 2, title: 'Zahlen', titleEn: 'Numbers', exercises: fixtureUnit.exercises.map((e) => ({ ...e, id: e.id.replace('u01', 'u02') })) });
const a2 = CompiledUnit.parse({ ...fixtureUnit, id: 'a2-u01', level: 'A2', title: 'Alltag', titleEn: 'Everyday life', exercises: fixtureUnit.exercises.map((e) => ({ ...e, id: e.id.replace('a1', 'a2') })) });
const packs: LevelPack[] = [
  { level: 'A1', version: 't', builtAt: '2026-01-01T00:00:00.000Z', units: [fixtureUnit, unit2], exams: [] },
  { level: 'A2', version: 't', builtAt: '2026-01-01T00:00:00.000Z', units: [a2], exams: [] },
];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

beforeEach(async () => {
  await db.settings.clear();
  useContent.getState().setPacks(packs);
});

describe('placement explanation', () => {
  it('explains each branch of the placement rule', () => {
    const units = { A1: 12, A2: 12 };
    expect(explainPlacement([{ level: 'A1', score: 0.4, items: 10 }], { level: 'A1', unit: 1 }, units)[0]).toMatch(/scored 40% .* passed at 70%.*A1, unit 1/);
    expect(explainPlacement([{ level: 'A1', score: 0.95, items: 10 }], { level: 'A2', unit: 1 }, units)[0]).toMatch(/mastered it, so you start at the next level: A2, unit 1/);
    const mid = explainPlacement(
      [
        { level: 'A1', score: 0.8, items: 10 },
        { level: 'A2', score: 0.3, items: 10 },
      ],
      { level: 'A1', unit: 7 },
      units,
    );
    expect(mid[0]).toMatch(/passed A1 with 80%.*unit 7 of 12/);
    expect(mid[1]).toMatch(/On A2 you scored 30%, below the 70% pass mark/);
    expect(explainPlacement([{ level: 'A1', score: 1, items: 5 }], { level: 'A1', unit: 2 }, { A1: 2 })[0]).toMatch(/A2 lessons aren't available yet.*last A1 unit \(unit 2\)/);
    // A2 is a preview (3 of 12 units): the proportional placement says so.
    const partial = { A1: 12, A2: 3 };
    const inA2 = explainPlacement(
      [
        { level: 'A1', score: 1, items: 15 },
        { level: 'A2', score: 0.75, items: 15 },
      ],
      { level: 'A2', unit: 3 },
      partial,
    );
    expect(inA2.join(' ')).toMatch(/passed A2 with 75%.*unit 3 of 3 \(the A2 units available so far; A2 is a preview\)/);
    expect(explainPlacement([{ level: 'A1', score: 0.8, items: 15 }], { level: 'A1', unit: 7 }, partial)[0]).toMatch(/unit 7 of 12\.$/);
  });

  it('scores levels and stops counting after the first level below the pass mark', () => {
    const s = levelScores([
      { level: 'A2', score: 1 },
      { level: 'A1', score: 0.5 },
      { level: 'A1', score: 0.7 },
    ]);
    expect(s.map((x) => x.level)).toEqual(['A1', 'A2']);
    expect(s[0]!.score).toBeCloseTo(0.6);
    expect(verdicts(s).map((v) => v.verdict)).toEqual(['not passed', 'not counted']);
  });
});

describe('Placement screen', () => {
  it('runs sections per level, stops after a failed level and saves the result', async () => {
    render(
      <MemoryRouter initialEntries={['/placement']}>
        <Routes>
          <Route path="/placement" element={<Placement />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Placement test' })).toBeInTheDocument();
    expect(screen.getByText(/questions in 2 sections \(A1, A2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start the test' }));

    // Answer every A1 question wrong: the mcq with a wrong option, the rest with nonsense.
    for (let guard = 0; guard < 20; guard++) {
      if (screen.queryByRole('heading', { name: /Your starting point/ })) break;
      expect(screen.getByText(/Section 1 of 2: A1/)).toBeInTheDocument();
      const radios = screen.queryAllByRole('radio');
      if (radios.length) fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
      for (const gap of screen.queryAllByLabelText(/^Gap \d+$/)) fireEvent.change(gap, { target: { value: 'xyz' } });
      const words = screen.queryByRole('group', { name: 'Words' });
      if (words) for (const b of Array.from(words.querySelectorAll('button')).reverse()) fireEvent.click(b);
      fireEvent.click(screen.getByRole('button', { name: 'Check' }));
      await screen.findByText('Answer saved.');
      fireEvent.click(screen.getByRole('button', { name: /^(Next|See result)$/ }));
      await waitFor(() => expect(screen.queryByText('Answer saved.')).not.toBeInTheDocument());
    }

    expect(await screen.findByRole('heading', { name: 'Your starting point: A1, unit 1' })).toBeInTheDocument();
    expect(screen.getByText(/A level counts as passed at 70%/)).toBeInTheDocument();
    expect(screen.getByText(/the test ended early/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start from A1 unit 1 instead' })).not.toBeInTheDocument();

    const saved = await getSettings();
    expect(saved.placement).toMatchObject({ level: 'A1', unit: 1, stoppedEarly: true });
    expect(saved.placement!.perLevel.map((l) => l.level)).toEqual(['A1']);

    fireEvent.click(screen.getByRole('button', { name: 'Start here' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/unit/a1-u01');
  });

  it('results: "Start here" opens the placed unit, or the learner can start from A1 unit 1', async () => {
    const result: PlacementResult = {
      at: '2026-10-01T10:00:00.000Z',
      level: 'A1',
      unit: 2,
      perLevel: [
        { level: 'A1', score: 0.85, items: 6 },
        { level: 'A2', score: 0.2, items: 6 },
      ],
      answered: 12,
      total: 12,
      durationSec: 600,
      stoppedEarly: false,
    };
    render(
      <MemoryRouter initialEntries={['/placement']}>
        <Routes>
          <Route path="/placement" element={<PlacementResults result={result} packs={packs} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Your starting point: A1, unit 2' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent(/A1\s*6\s*85%\s*passed/);
    expect(screen.getByRole('table')).toHaveTextContent(/A2\s*6\s*20%\s*not passed/);
    expect(screen.getByText(/passed A1 with 85%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start from A1 unit 1 instead' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/learn/A1'));
    expect(await getSettings()).toMatchObject({ level: 'A1', startUnit: 1 });
  });
});
