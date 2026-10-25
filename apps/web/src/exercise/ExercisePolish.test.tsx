import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '../db';
import { exercise, fixtureUnit } from '../test/fixtures';
import { ExercisePlayer } from './ExercisePlayer';
import { UmlautBar } from './UmlautBar';
import { resultTone } from '../lib/feedback';

const key = (k: string, target: Element = document.body) => fireEvent.keyDown(target, { key: k });

beforeEach(async () => {
  await db.attempts.clear();
  await db.settings.clear();
});

describe('keyboard', () => {
  it('number keys pick a multiple-choice option and Enter checks, then moves on', async () => {
    const onNext = vi.fn();
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} onDone={onDone} onNext={onNext} />);
    const radios = screen.getAllByRole('radio');
    const second = radios[1]!;
    key('2');
    expect(second).toHaveAttribute('aria-checked', 'true');
    expect(second).toHaveAttribute('aria-keyshortcuts', '2');

    // Pick "bin" by its shown position, then Enter checks.
    const binPos = radios.findIndex((r) => r.textContent?.endsWith('bin'));
    key(String(binPos + 1));
    key('Enter');
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: true, tone: 'right' }));
    expect(onNext).not.toHaveBeenCalled();

    key('Enter');
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('Enter on a focused option checks instead of re-clicking it', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} onDone={onDone} />);
    const bin = screen.getByRole('radio', { name: 'bin' });
    fireEvent.click(bin);
    bin.focus();
    key('Enter', bin);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('digits typed in a text field stay in the field', () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} />);
    const gap = screen.getByLabelText('Gap 1');
    gap.focus();
    key('1', gap);
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});

describe('result states', () => {
  it('shows a distinct "Almost!" state for a near miss', async () => {
    const onDone = vi.fn();
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText('Gap 1'), { target: { value: 'bisst' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    const result = await screen.findByRole('region', { name: 'Result' });
    expect(result).toHaveAttribute('data-tone', 'almost');
    expect(result).toHaveTextContent('Almost!');
    expect(result).not.toHaveTextContent('Not quite');
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: false, tone: 'almost' }));
  });

  it('classifies results', () => {
    expect(resultTone({ correct: true, score: 1, feedback: [] })).toBe('right');
    expect(resultTone({ correct: false, score: 0.7, feedback: ['Almost! “bisst” should be “bist”.'] })).toBe('almost');
    expect(resultTone({ correct: false, score: 0.5, feedback: [] })).toBe('wrong');
    expect(resultTone({ correct: false, score: 0, feedback: [] })).toBe('wrong');
  });
});

describe('haptics', () => {
  const vibrate = vi.fn(() => true);
  beforeEach(() => {
    vibrate.mockClear();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  });
  afterEach(() => {
    // @ts-expect-error test cleanup of a stubbed API
    delete navigator.vibrate;
    vi.unstubAllGlobals();
  });

  it('vibrates with a different pattern for wrong answers', async () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Not quite');
    expect(vibrate).toHaveBeenCalledWith([70, 50, 70]);
  });

  it('stays still when haptics are off in settings', async () => {
    await db.settings.put({ ...(await import('../db')).DEFAULT_SETTINGS, haptics: false });
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    // Let the settings subscription deliver the stored value.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    fireEvent.click(screen.getByRole('radio', { name: 'bin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Richtig!');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('stays still when the system prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    fireEvent.click(screen.getByRole('radio', { name: 'bin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Richtig!');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate in the placement test (no feedback shown)', async () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} record={false} showFeedback={false} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await screen.findByText('Answer saved.');
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('UmlautBar', () => {
  it('inserts at the caret, replacing a selection', () => {
    const input = document.createElement('input');
    input.value = 'Mdchen';
    document.body.appendChild(input);
    input.setSelectionRange(1, 1);
    const onInsert = vi.fn();
    render(<UmlautBar target={() => input} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert ä' }));
    expect(onInsert).toHaveBeenLastCalledWith('Mädchen');

    input.value = 'Strasse';
    input.setSelectionRange(4, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Insert ß' }));
    expect(onInsert).toHaveBeenLastCalledWith('Straße');
    input.remove();
  });

  it('is offered on every text answer', () => {
    render(<ExercisePlayer exercise={exercise('a1-u01-gap-1')} unit={fixtureUnit} />);
    expect(screen.getByRole('group', { name: 'Insert special characters' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Gap 1'));
    fireEvent.focus(screen.getByLabelText('Gap 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert ü' }));
    expect(screen.getByLabelText('Gap 1')).toHaveValue('ü');
  });
});
