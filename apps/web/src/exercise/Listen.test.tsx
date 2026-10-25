import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Exercise } from '@doppelpunkt/content-schema';
import { db } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { installMedia } from '../test/media';
import { ExercisePlayer } from './ExercisePlayer';
import { spokenText } from './Listen';

let media: ReturnType<typeof installMedia>;
beforeEach(async () => {
  await db.attempts.clear();
});
afterEach(() => media?.restore());

const listening = (over: Record<string, unknown> = {}) =>
  Exercise.parse({
    id: 'a1-u01-lis-test',
    type: 'mcq',
    skill: 'listening',
    prompt: 'Listen to Tom. Where is he from?',
    transcript: 'Tom: Ich komme aus Berlin.\nAnna: Aus Berlin? Toll!',
    options: ['Wien', 'Berlin'],
    answer: 1,
    explanation: 'aus Berlin.',
    ...over,
  });

describe('listening items', () => {
  it('play the transcript without showing it, then reveal it with the feedback', async () => {
    media = installMedia();
    render(<ExercisePlayer exercise={listening()} unit={fixtureUnit} record={false} />);
    expect(screen.queryByText(/Ich komme aus Berlin/)).toBeNull();
    // The play buttons must not leak the transcript through their accessible names either.
    fireEvent.click(screen.getByRole('button', { name: 'Play the recording' }));
    await waitFor(() => expect(media.spoken).toHaveLength(1));
    expect(media.spoken[0]).toMatchObject({ text: 'Ich komme aus Berlin.\nAus Berlin? Toll!', lang: 'de-DE', rate: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Play the recording slower' }));
    await waitFor(() => expect(media.spoken[1]?.rate).toBe(0.75));

    fireEvent.click(screen.getByRole('radio', { name: 'Berlin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    expect(screen.getByText('What you heard')).toBeInTheDocument();
    expect(screen.getByText(/Tom: Ich komme aus Berlin\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play the recording' })).toBeNull();
  });

  it('show Swiss German without a recording as text ("read instead") and never use TTS', () => {
    media = installMedia();
    render(<ExercisePlayer exercise={listening({ variety: 'gsw-zh', transcript: 'Reto: Ich chume us Bärn.' })} unit={fixtureUnit} record={false} />);
    expect(screen.getByText('No recording yet — read instead')).toBeInTheDocument();
    expect(screen.getByText('Reto: Ich chume us Bärn.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play/ })).toBeNull();
    expect(media.spoken).toHaveLength(0);
  });

  it('fall back to reading when the device has no TTS', () => {
    media = installMedia({ tts: false });
    render(<ExercisePlayer exercise={listening()} unit={fixtureUnit} record={false} />);
    expect(screen.getByText("This device can't read German aloud — read instead")).toBeInTheDocument();
    expect(screen.getByText(/Ich komme aus Berlin/)).toBeInTheDocument();
  });

  it('strip speaker labels before reading aloud', () => {
    expect(spokenText('Sprecher: Gespräch 1.\nFrau: Wo ist die Milch?\n\nMann: Hinten links.')).toBe('Gespräch 1.\nWo ist die Milch?\nHinten links.');
    expect(spokenText('Information am Gleis 7: Der Zug fährt.')).toBe('Information am Gleis 7: Der Zug fährt.');
  });
});
