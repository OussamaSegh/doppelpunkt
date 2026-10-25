import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CompiledUnit, type LevelPack } from '@doppelpunkt/content-schema';
import { useContent } from '../content';
import { fixtureUnit } from '../test/fixtures';
import { fold, grammarIndex, searchGrammar } from '../lib/grammar';
import { Grammar } from './Grammar';

const unit2 = CompiledUnit.parse({
  ...fixtureUnit,
  id: 'a1-u02',
  number: 2,
  title: 'Im Café',
  titleEn: 'At the café',
  grammar: [
    { id: 'verb-second', title: 'Word order: the verb comes second', body: 'In a statement the verb is in **position 2**: *Heute trinke ich Kaffee.*' },
    { id: 'eszett', title: 'ß or ss', body: 'Germany writes *Straße*, Switzerland writes *Strasse*. Über ß in Switzerland.' },
  ],
  exercises: [
    { ...fixtureUnit.exercises[2]!, id: 'a1-u02-order-1', grammar: ['verb-second'] },
    { id: 'a1-u02-zh-1', type: 'mcq', skill: 'vocabulary', variety: 'gsw-zh', prompt: 'Pick the Zurich word.', options: ['Hoi', 'Moin'], answer: 0, explanation: 'Hoi is Swiss.', grammar: ['verb-second'] },
  ],
});
const packs: LevelPack[] = [{ level: 'A1', version: 't', builtAt: '2026-01-01T00:00:00.000Z', units: [fixtureUnit, unit2] }];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grammar" element={<Grammar />} />
        <Route path="/grammar/:unitId/:grammarId" element={<Grammar />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => useContent.getState().setPacks(packs));

describe('grammar search', () => {
  it('folds accents, umlauts and ß', () => {
    expect(fold('Über Straße')).toBe('uber strasse');
  });

  it('matches title and body, accent-insensitive, title hits first', () => {
    const entries = grammarIndex(packs);
    const ids = (q: string) => searchGrammar(entries, q).map((e) => e.point.id);
    expect(ids('verb')).toEqual(['verb-second']);
    expect(ids('strasse')).toEqual(['eszett']);
    expect(ids('uber')).toEqual(['eszett']);
    expect(ids('ueber')).toEqual(['eszett']);
    expect(ids('ich bin')).toEqual(['sein-present']);
    expect(ids('position 2')).toEqual(['verb-second']);
    expect(ids('nothing like this')).toEqual([]);
  });
});

describe('Grammar screen', () => {
  it('lists grammar by level and unit and filters with search', () => {
    renderAt('/grammar');
    expect(screen.getByRole('heading', { level: 1, name: 'Grammar reference' })).toBeInTheDocument();
    const a1 = screen.getByRole('region', { name: 'A1' });
    expect(within(a1).getByRole('list', { name: 'Unit 1 grammar' })).toHaveTextContent('sein (to be)');
    expect(within(a1).getByRole('list', { name: 'Unit 2 grammar' })).toHaveTextContent('ß or ss');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search grammar' }), { target: { value: 'STRASSE' } });
    expect(screen.getByRole('status')).toHaveTextContent('1 grammar point found');
    const results = screen.getByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link')).toHaveAttribute('href', '/grammar/a1-u02/eszett');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search grammar' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('shows a grammar point with links to the exercises that practise it', () => {
    renderAt('/grammar/a1-u02/verb-second');
    expect(screen.getByRole('heading', { level: 1, name: 'Word order: the verb comes second' })).toBeInTheDocument();
    expect(screen.getByText('position 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Put the words in order.' })).toHaveAttribute('href', '/unit/a1-u02/uebungen?item=a1-u02-order-1');
    expect(screen.getByRole('link', { name: 'Pick the Zurich word.' })).toHaveAttribute('href', '/unit/a1-u02/schwiiz?item=a1-u02-zh-1');
    expect(screen.getByRole('link', { name: /Back to unit 2/ })).toHaveAttribute('href', '/unit/a1-u02/grammatik');
  });

  it('says so when a grammar point is missing', () => {
    renderAt('/grammar/a1-u09/nope');
    expect(screen.getByRole('heading', { name: 'Grammar point not found' })).toBeInTheDocument();
  });
});
