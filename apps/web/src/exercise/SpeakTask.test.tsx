import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompiledUnit } from '@doppelpunkt/content-schema';
import { estimateSkills } from '@doppelpunkt/engine';
import { db } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { installMedia } from '../test/media';
import { SpeakTask } from './SpeakTask';

// The AI hook is swapped per test: no key by default, or a provider that can transcribe.
const ai = vi.hoisted(() => ({ value: { status: 'no-key' } as Record<string, unknown> }));
vi.mock('../lib/ai', async (orig) => ({ ...(await orig<typeof import('../lib/ai')>()), useAi: () => ai.value }));

const unit = CompiledUnit.parse({
  ...fixtureUnit,
  exercises: [
    ...fixtureUnit.exercises,
    {
      id: 'a1-u01-speak-1',
      type: 'speak',
      skill: 'vocabulary',
      prompt: 'Say it.',
      explanation: 'Stress on the first syllable.',
      target: 'Hallo, ich bin Anna.',
    },
    {
      id: 'a1-u01-speak-zh',
      type: 'speak',
      skill: 'speaking',
      variety: 'gsw-zh',
      prompt: 'Say it.',
      explanation: 'Zurich greeting.',
      target: 'Hoi zäme',
    },
  ],
});
const speak = (id: string) => unit.exercises.find((e) => e.id === id) as Extract<CompiledUnit['exercises'][number], { type: 'speak' }>;

let media: ReturnType<typeof installMedia>;
beforeEach(async () => {
  await db.attempts.clear();
  await db.unitStatus.clear();
  ai.value = { status: 'no-key' };
});
afterEach(() => media?.restore());

async function recordTake() {
  fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  return screen.findByRole('button', { name: 'Stop recording' });
}

describe('SpeakTask', () => {
  it('browser recognition (de-DE): transcript, word diff and a speaking attempt', async () => {
    media = installMedia({ recognition: true });
    const onDone = vi.fn();
    render(<SpeakTask ex={speak('a1-u01-speak-1')} unit={unit} record onDone={onDone} />);
    expect(screen.getByText('Speech recognition: your browser (de-DE).')).toBeInTheDocument();

    const stop = await recordTake();
    const rec = media.recognition()!;
    expect(rec.lang).toBe('de-DE');
    act(() => rec.hear('hallo ich bin'));
    fireEvent.click(stop);

    expect(await screen.findByDisplayValue('hallo ich bin')).toBeInTheDocument();
    expect(screen.getByText('Recognised by your browser (de-DE)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByLabelText('Word by word comparison')).toHaveTextContent('Anna');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ exerciseId: 'a1-u01-speak-1', correct: false })));
    const [a] = await db.attempts.toArray();
    // The item is tagged "vocabulary" but a speak item always counts as speaking.
    expect(a).toMatchObject({ skill: 'speaking', variety: 'de', unitId: 'a1-u01' });
    expect(a!.score).toBeCloseTo(0.75);
  });

  it('marks the path as corrected when the learner edits the transcript', async () => {
    media = installMedia({ recognition: true });
    render(<SpeakTask ex={speak('a1-u01-speak-1')} unit={unit} record onDone={() => undefined} />);
    const stop = await recordTake();
    act(() => media.recognition()!.hear('hallo ich bin anna'));
    fireEvent.click(stop);
    fireEvent.change(await screen.findByLabelText('What we heard (you can correct it)'), { target: { value: 'Hallo, ich bin Anna.' } });
    expect(screen.getByText('Recognised by your browser (de-DE), corrected by you')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
  });

  it('uses de-CH for recognition of Swiss varieties and warns it only knows Standard German', async () => {
    media = installMedia({ recognition: true });
    render(<SpeakTask ex={speak('a1-u01-speak-zh')} unit={unit} record={false} onDone={() => undefined} />);
    expect(screen.getByText(/only knows Standard German \(de-CH\)/)).toBeInTheDocument();
    expect(screen.getAllByText('No recording yet').length).toBeGreaterThan(0);
    await recordTake();
    expect(media.recognition()!.lang).toBe('de-CH');
  });

  it('falls back to provider transcription (OpenAI) when the browser cannot recognise speech', async () => {
    media = installMedia({ recognition: false });
    const transcribe = vi.fn(async () => 'Hallo, ich bin Anna.');
    ai.value = { status: 'ready', providerId: 'openai', model: 'gpt-4o-mini', provider: { id: 'openai', transcribe } };
    const onDone = vi.fn();
    render(<SpeakTask ex={speak('a1-u01-speak-1')} unit={unit} record onDone={onDone} />);
    expect(screen.getByText(/OpenAI can transcribe it with your key/)).toBeInTheDocument();
    fireEvent.click(await recordTake());
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe with OpenAI' }));
    expect(await screen.findByDisplayValue('Hallo, ich bin Anna.')).toBeInTheDocument();
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), 'de');
    expect(screen.getByText('Transcribed by OpenAI')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ correct: true, score: 1 })));
  });

  it('asks Gemini for Swiss German transcription with lang "gsw"', async () => {
    media = installMedia({ recognition: false });
    const transcribe = vi.fn(async () => 'Hoi zäme');
    ai.value = { status: 'ready', providerId: 'gemini', model: 'x', provider: { id: 'gemini', transcribe } };
    render(<SpeakTask ex={speak('a1-u01-speak-zh')} unit={unit} record={false} onDone={() => undefined} />);
    fireEvent.click(await recordTake());
    fireEvent.click(await screen.findByRole('button', { name: 'Transcribe with Gemini' }));
    await screen.findByText('Transcribed by Gemini');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), 'gsw');
  });

  it('hides provider transcription when the provider has no transcribe (e.g. Anthropic)', async () => {
    media = installMedia({ recognition: false });
    ai.value = { status: 'ready', providerId: 'anthropic', model: 'x', provider: { id: 'anthropic' } };
    render(<SpeakTask ex={speak('a1-u01-speak-1')} unit={unit} record onDone={() => undefined} />);
    fireEvent.click(await recordTake());
    await screen.findByLabelText('Your recording');
    expect(screen.queryByRole('button', { name: /Transcribe with/ })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Rate yourself' })).toBeInTheDocument();
  });

  it('self-rating: records a speaking attempt that feeds the Swiss band for gsw items', async () => {
    media = installMedia({ recorder: false, recognition: false });
    const onDone = vi.fn();
    render(<SpeakTask ex={speak('a1-u01-speak-zh')} unit={unit} record onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sounded right' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ score: 1, correct: true })));
    expect(await screen.findByText('Self-rated')).toBeInTheDocument();
    expect(screen.getByText('Zurich greeting.')).toBeInTheDocument();
    const attempts = await db.attempts.toArray();
    expect(attempts[0]).toMatchObject({ skill: 'speaking', variety: 'gsw-zh' });
    const est = estimateSkills(attempts);
    expect(est.find((e) => e.skill === 'speaking')?.attempts).toBe(1);
    expect(est.find((e) => e.skill === 'swiss')?.attempts).toBe(1);
  });

  it('shadowing mode adds speed and "listen, then speak"', async () => {
    media = installMedia({ recognition: true });
    render(<SpeakTask ex={speak('a1-u01-speak-1')} unit={unit} record={false} onDone={() => undefined} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shadowing mode' }));
    fireEvent.click(screen.getByRole('radio', { name: '0.75×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Listen, then speak' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    expect(media.spoken[0]).toMatchObject({ text: 'Hallo, ich bin Anna.', rate: 0.75, lang: 'de-DE' });
  });
});
