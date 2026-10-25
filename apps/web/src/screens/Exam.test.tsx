import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MockExam, type LevelPack } from '@doppelpunkt/content-schema';
import { useContent } from '../content';
import { db } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { announcement, clock, practiseLinks, verdictText } from '../lib/exam';
import { Exam } from './Exam';

// A tiny exam in the real format: reading (mcq + gap), writing (open task). Illustrative content.
const exam = MockExam.parse({
  id: 'a1-mock-test',
  level: 'A1',
  title: 'Modelltest A1',
  format: 'goethe',
  passMark: 0.6,
  sections: [
    {
      id: 'lesen',
      skill: 'reading',
      title: 'Lesen',
      minutes: 1,
      instructions: 'Read the text. *Lesen Sie den Text.*',
      stimulus: { title: 'Eine Nachricht', text: 'Hallo, ich bin Anna. Ich komme aus Bern.' },
      exercises: [
        { ...fixtureUnit.exercises[0]!, id: 'ex-mcq' },
        { ...fixtureUnit.exercises[1]!, id: 'ex-gap' },
      ],
      points: [2, 1],
    },
    {
      id: 'schreiben',
      skill: 'writing',
      title: 'Schreiben',
      minutes: 20,
      instructions: 'Write a short message.',
      exercises: [
        {
          id: 'ex-write',
          type: 'write',
          skill: 'writing',
          prompt: 'Introduce yourself.',
          task: 'Write 3 sentences about you.',
          model: 'Ich heiße Ben. Ich komme aus Zürich. Ich wohne in Bern.',
          checklist: ['I said my name.', 'I said where I am from.'],
          explanation: 'Name, origin, home: the A1 basics.',
          grammar: ['sein-present'],
        },
      ],
      points: [4],
    },
  ],
});

const pack: LevelPack = { level: 'A1', version: 't', builtAt: '2026-01-01T00:00:00.000Z', units: [fixtureUnit], exams: [exam] };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exam" element={<Exam />} />
        <Route path="/exam/:examId" element={<Exam />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.examResults.clear();
  await db.aiKeys.clear();
  await db.settings.clear();
  useContent.getState().setPacks([pack]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('exam helpers', () => {
  it('formats the clock and announces only at 5 and 1 minutes', () => {
    expect(clock(125)).toBe('2:05');
    expect(clock(0)).toBe('0:00');
    expect(announcement(300, 1200)).toMatch(/5 minutes left/);
    expect(announcement(60, 1200)).toMatch(/1 minute left/);
    expect(announcement(59, 1200)).toBeUndefined();
    expect(announcement(300, 300)).toBeUndefined();
  });

  it('says pass or fail in plain English', () => {
    expect(verdictText({ points: 6, max: 10, passMark: 0.6, passed: true }).headline).toBe('You passed the mock exam.');
    const fail = verdictText({ points: 4.5, max: 10, passMark: 0.6, passed: false });
    expect(fail.headline).toBe("You didn't pass this time.");
    expect(fail.detail).toMatch(/4.5 of 10 points \(45%\).*60% \(6 points\).*1.5 points short/);
  });

  it('links lost points to the grammar points that teach them', () => {
    const links = practiseLinks(exam, pack, [
      { exerciseId: 'ex-mcq', points: 0, max: 2 },
      { exerciseId: 'ex-gap', points: 1, max: 1 },
      { exerciseId: 'ex-write', points: 2, max: 4 },
    ]);
    expect(links).toEqual([{ grammarId: 'sein-present', title: 'sein (to be)', unitId: 'a1-u01', lost: 4 }]);
  });
});

describe('Mock exam screen', () => {
  it('lists the exam with its sections and time', async () => {
    renderAt('/exam');
    expect(await screen.findByRole('heading', { level: 1, name: 'Mock exams' })).toBeInTheDocument();
    const card = screen.getByRole('article', { name: 'Modelltest A1' });
    expect(card).toHaveTextContent('Goethe-Zertifikat format · 21 min · pass mark 60%');
    expect(within(card).getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/exam/a1-mock-test');
  });

  it('runs intro → sections without feedback → self-assessed writing → results and review, and saves the result', async () => {
    renderAt('/exam/a1-mock-test');
    expect(await screen.findByRole('heading', { level: 1, name: 'Modelltest A1' })).toBeInTheDocument();
    expect(screen.getByText(/This is practice, not an official certificate/)).toBeInTheDocument();
    expect(screen.getByText(/2 sections, 21 minutes in total, 7 points\. You pass with 60%/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Sections' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start the exam' }));

    // Section 1: stimulus above the items, a visible countdown, no Check button and no feedback.
    expect(await screen.findByRole('heading', { level: 2, name: /Section 1 of 2: Lesen/ })).toHaveFocus();
    expect(screen.getByRole('timer')).toHaveTextContent('1:00');
    expect(screen.getByRole('heading', { name: 'Eine Nachricht' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'bin' }));
    expect(screen.queryByText('Richtig!')).not.toBeInTheDocument();
    expect(screen.queryByText(fixtureUnit.exercises[0]!.explanation)).not.toBeInTheDocument();

    // The gap is left empty: moving on asks first.
    fireEvent.click(screen.getByRole('button', { name: 'Next section' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 item is not answered yet and will get 0 points');
    fireEvent.click(screen.getByRole('button', { name: 'Yes, go on' }));

    // Section 2: writing.
    expect(await screen.findByRole('heading', { level: 2, name: /Section 2 of 2: Schreiben/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Ich heiße Mia. Ich komme aus Wien.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish the exam' }));

    // No AI key: self-assessment against the checklist.
    expect(await screen.findByRole('heading', { level: 2, name: 'Score your writing and speaking' })).toBeInTheDocument();
    expect(await screen.findByText(/Add an AI key in Settings/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Score with AI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See my results' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I said my name.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save my score' }));
    expect(screen.getByText('2 of 4 points, scored by you.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See my results' }));

    // Results: mcq 2/2, gap 0/1, writing 2/4 → 4 of 7 = 57% < 60%.
    expect(await screen.findByRole('heading', { level: 1, name: /not passed yet/ })).toBeInTheDocument();
    expect(screen.getByText("You didn't pass this time.")).toBeInTheDocument();
    expect(screen.getByText(/You scored 4 of 7 points \(57%\)/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Points per section' });
    expect(within(table).getByRole('row', { name: /Lesen/ })).toHaveTextContent('2 / 3');
    expect(within(table).getByRole('row', { name: /Schreiben/ })).toHaveTextContent('2 / 4');
    expect(within(table).getByRole('row', { name: /Total/ })).toHaveTextContent('4 / 7');

    // Practise links and the full review with every solution and explanation.
    expect(screen.getByRole('link', { name: 'sein (to be)' })).toHaveAttribute('href', '/grammar/a1-u01/sein-present');
    const gap = screen.getByRole('article', { name: /Fill in the gap/ });
    expect(gap).toHaveTextContent('0 / 1 points');
    expect(gap).toHaveTextContent('Not answered.');
    expect(gap).toHaveTextContent('Du bist Ben.');
    expect(gap).toHaveTextContent(fixtureUnit.exercises[1]!.explanation);
    const write = screen.getByRole('article', { name: /Introduce yourself/ });
    expect(write).toHaveTextContent('Scored by you.');
    expect(write).toHaveTextContent('Ich heiße Ben. Ich komme aus Zürich.');
    expect(within(write).getByRole('list', { name: 'Your checklist' })).toHaveTextContent('I said my name.(ticked)');

    await waitFor(async () => expect(await db.examResults.count()).toBe(1));
    const [row] = await db.examResults.toArray();
    expect(row).toMatchObject({ examId: 'a1-mock-test', level: 'A1', points: 4, max: 7, passed: false, passMark: 0.6 });
    expect(row!.items.find((i) => i.exerciseId === 'ex-write')).toMatchObject({ method: 'self', points: 2, selfCheck: [true, false] });
    expect(row!.items.find((i) => i.exerciseId === 'ex-gap')).toMatchObject({ method: 'unanswered', points: 0 });
    expect(row!.sections.map((s) => s.timedOut)).toEqual([false, false]);
  });

  it('pauses the countdown, then moves on by itself with a warning when the time is up', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    renderAt('/exam/a1-mock-test');
    fireEvent.click(await screen.findByRole('button', { name: 'Start the exam' }));
    await screen.findByRole('heading', { level: 2, name: /Lesen/ });

    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:40');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByText('Paused')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(screen.getByRole('timer')).toHaveTextContent('0:40');
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume' })[0]!);

    act(() => void vi.advanceTimersByTime(40_500));
    expect(await screen.findByRole('heading', { level: 2, name: /Schreiben/ })).toBeInTheDocument();
    expect(screen.getByText(/Time is up for Lesen\. Your answers there are saved and the exam has moved on to Schreiben/)).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('20:00');
  });

  it('shows a saved attempt again from its id', async () => {
    const id = await db.examResults.add({
      examId: exam.id,
      level: 'A1',
      at: '2026-10-01T10:00:00.000Z',
      points: 6,
      max: 7,
      passMark: 0.6,
      passed: true,
      durationSec: 600,
      pausedSec: 0,
      sections: [
        { sectionId: 'lesen', points: 3, max: 3, usedSec: 50, timedOut: false },
        { sectionId: 'schreiben', points: 3, max: 4, usedSec: 550, timedOut: false },
      ],
      items: [
        { exerciseId: 'ex-mcq', sectionId: 'lesen', points: 2, max: 2, score: 1, method: 'auto', answer: 'bin' },
        { exerciseId: 'ex-gap', sectionId: 'lesen', points: 1, max: 1, score: 1, method: 'auto', answer: 'Du bist Ben.' },
        { exerciseId: 'ex-write', sectionId: 'schreiben', points: 3, max: 4, score: 0.75, method: 'ai', answer: 'Ich heiße Mia.' },
      ],
    });
    renderAt(`/exam/a1-mock-test?result=${id}`);
    expect(await screen.findByRole('heading', { level: 1, name: /Bestanden — passed/ })).toBeInTheDocument();
    expect(screen.getByText('You passed the mock exam.')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /Introduce yourself/ })).toHaveTextContent('Scored by your AI tutor.');
  });
});
