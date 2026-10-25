import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PronunciationDrill } from '@doppelpunkt/content-schema';
import { estimateSkills } from '@doppelpunkt/engine';
import { db } from '../db';
import { discriminationQuiz, drillAudioUrl, loadPronunciation, usePronunciation } from '../lib/pronunciation';
import { FakeAudio, installMedia } from '../test/media';
import { Pronunciation } from './Pronunciation';

const ue = PronunciationDrill.parse({
  id: 'ue-u',
  title: 'ü vs u',
  ipa: ['y', 'u'],
  explanation: 'Say **ee**, then round your lips.',
  tips: ['Keep your tongue forward.'],
  pairs: [
    [
      { text: 'Mütter', en: 'mothers' },
      { text: 'Mutter', en: 'mother' },
    ],
    [
      { text: 'Tür', en: 'door' },
      { text: 'tour', en: 'tour' },
    ],
  ],
  words: [
    { text: 'über', en: 'over' },
    { text: 'grün', en: 'green' },
  ],
  sentences: [{ text: 'Die Tür ist grün.', en: 'The door is green.' }],
  commonMistakes: ['Saying "oo" for ü.'],
});
const swissCh = PronunciationDrill.parse({
  id: 'swiss-ch',
  title: 'Swiss ch',
  level: 'A1',
  variety: 'gsw-zh',
  explanation: 'Always the back ch.',
  pairs: [
    [
      { text: 'Chuchi', en: 'kitchen' },
      { text: 'Kuchi', en: '(not a word)' },
    ],
  ],
  words: [{ text: 'Chäs', en: 'cheese', audio: 'chaes.mp3' }],
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pronunciation" element={<Pronunciation />} />
        <Route path="/pronunciation/:drillId" element={<Pronunciation />} />
      </Routes>
    </MemoryRouter>,
  );
}

let media: ReturnType<typeof installMedia>;
beforeEach(async () => {
  await db.attempts.clear();
  media = installMedia({ recorder: false, recognition: false });
  usePronunciation.getState().setDrills([ue, swissCh]);
});
afterEach(() => media.restore());

const json = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('loadPronunciation', () => {
  it('validates the pack', async () => {
    const ok = await loadPronunciation(json({ version: '1', builtAt: 'x', drills: [ue] }));
    expect(ok).toMatchObject({ status: 'ready' });
    expect(ok.drills[0]?.id).toBe('ue-u');
    const bad = await loadPronunciation(json({ version: '1', builtAt: 'x', drills: [{ id: 'x' }] }));
    expect(bad.status).toBe('error');
    expect(bad.error).toMatch(/failed validation/);
  });

  it('treats a missing pack as empty, not an error', async () => {
    expect((await loadPronunciation(json({}, 404))).status).toBe('empty');
    const html = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    expect((await loadPronunciation(html)).status).toBe('empty');
  });

  it('resolves drill audio under packs/audio/pronunciation/<id>/', () => {
    expect(drillAudioUrl(swissCh, 'chaes.mp3')).toBe('/packs/audio/pronunciation/swiss-ch/chaes.mp3');
    expect(drillAudioUrl(swissCh, undefined)).toBeUndefined();
  });

  it('builds one quiz question per pair word, each with both words of its pair', () => {
    const q = discriminationQuiz(ue);
    expect(q).toHaveLength(4);
    for (const item of q) expect(item.options[item.answer]).toBe(item.play);
  });
});

describe('Pronunciation screen', () => {
  it('shows a graceful empty state when no drills are installed', () => {
    usePronunciation.getState().setDrills([]);
    renderAt('/pronunciation');
    expect(screen.getByRole('heading', { name: 'No pronunciation drills installed yet' })).toBeInTheDocument();
  });

  it('lists the drills with their variety', () => {
    renderAt('/pronunciation');
    const list = screen.getByRole('list', { name: 'Pronunciation drills' });
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).getByRole('link', { name: /ü vs u/ })).toHaveAttribute('href', '/pronunciation/ue-u');
    expect(within(list).getByRole('link', { name: /Swiss ch/ })).toHaveTextContent('ZH');
  });

  it('drill view: explanation, tips, pairs, words, sentences and common mistakes', () => {
    renderAt('/pronunciation/ue-u');
    expect(screen.getByRole('heading', { level: 1, name: /ü vs u/ })).toBeInTheDocument();
    expect(screen.getByText('ee', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Keep your tongue forward.')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Minimal pairs' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sentences' })).toBeInTheDocument();
    expect(screen.getByText('Saying "oo" for ü.')).toBeInTheDocument();
    expect(screen.getByText(/1 of 7/)).toBeInTheDocument();
  });

  it('quiz: plays a word, grades the pick and stores a listening attempt', async () => {
    renderAt('/pronunciation/ue-u');
    fireEvent.click(screen.getByRole('button', { name: 'Play the word' }));
    await waitFor(() => expect(media.spoken.length).toBe(1));
    const heard = media.spoken[0]!.text;
    fireEvent.click(within(screen.getByRole('group', { name: 'What did you hear?' })).getByRole('button', { name: heard }));
    expect(await screen.findByText('Richtig!')).toBeInTheDocument();
    await waitFor(async () => expect(await db.attempts.count()).toBe(1));
    expect((await db.attempts.toArray())[0]).toMatchObject({ unitId: 'pron-ue-u', skill: 'listening', score: 1, level: 'A1' });
  });

  it('repeat after me: a self-rated try is a speaking attempt that feeds the radar', async () => {
    renderAt('/pronunciation/ue-u');
    fireEvent.click(screen.getByRole('button', { name: 'Practise: grün' }));
    expect(screen.getByText(/6 of 7/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Rate yourself' })).getByRole('button', { name: 'Good' }));
    await waitFor(async () => expect(await db.attempts.count()).toBe(1));
    const attempts = await db.attempts.toArray();
    expect(attempts[0]).toMatchObject({ unitId: 'pron-ue-u', exerciseId: 'pron-ue-u-word-1', skill: 'speaking', variety: 'de', score: 1 });
    expect(estimateSkills(attempts).find((s) => s.skill === 'speaking')?.attempts).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(within(screen.getByRole('group', { name: 'Rate yourself' })).getByRole('button', { name: 'Good' })).toBeInTheDocument();
  });

  it('Swiss drills without recordings say "No recording yet" and skip the quiz; recorded words play', async () => {
    renderAt('/pronunciation/swiss-ch');
    expect(screen.getByText(/No recording yet: this quiz needs native recordings/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play the word' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Listen: Chäs' }));
    await waitFor(() => expect(FakeAudio.instances[0]?.src).toBe('/packs/audio/pronunciation/swiss-ch/chaes.mp3'));
    expect(media.spoken).toHaveLength(0);
  });

  it('an unknown drill shows a not-found state', () => {
    renderAt('/pronunciation/nope');
    expect(screen.getByRole('heading', { name: 'Drill not found' })).toBeInTheDocument();
  });
});
