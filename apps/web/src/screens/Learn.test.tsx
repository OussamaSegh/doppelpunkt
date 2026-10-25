// Learn with a partial level pack: A1 has all 12 units, A2 only some (v0.5 ships A2 units 1–3).
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CompiledUnit, type LevelPack } from '@doppelpunkt/content-schema';
import { useContent } from '../content';
import { db, updateSettings } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { isPreview, Learn } from './Learn';

const unitOf = (level: 'A1' | 'A2', n: number) => {
  const id = `${level.toLowerCase()}-u${String(n).padStart(2, '0')}`;
  return CompiledUnit.parse({
    ...fixtureUnit,
    id,
    level,
    number: n,
    title: `${level} Einheit ${n}`,
    exercises: fixtureUnit.exercises.map((e) => ({ ...e, id: e.id.replace('a1-u01', id) })),
  });
};
const pack = (level: 'A1' | 'A2', n: number): LevelPack => ({
  level,
  version: 't',
  builtAt: '2026-01-01T00:00:00.000Z',
  units: Array.from({ length: n }, (_, i) => unitOf(level, i + 1)),
  exams: [],
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn" element={<Learn />} />
        <Route path="/learn/:level" element={<Learn />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.settings.clear();
  await updateSettings({ onboarded: true });
  useContent.getState().setPacks([pack('A1', 12), pack('A2', 3)]);
});

describe('Learn: partial level packs', () => {
  it('isPreview: fewer than 12 units', () => {
    expect(isPreview(pack('A2', 3))).toBe(true);
    expect(isPreview(pack('A1', 12))).toBe(false);
  });

  it('shows A2 as "Preview — 3 of 12 units" and its units stay usable', async () => {
    renderAt('/learn/A2');
    expect(await screen.findByText('Preview — 3 of 12 units')).toBeVisible();
    const list = screen.getByRole('list', { name: 'A2 units' });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', '/unit/a2-u01');
    // The level switcher marks A2 as a preview, A1 not.
    const nav = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(nav).getByRole('link', { name: 'A2 preview' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'A1' })).toBeVisible();
  });

  it('a complete level has no preview note', async () => {
    renderAt('/learn/A1');
    expect(await screen.findByRole('list', { name: 'A1 units' })).toBeVisible();
    expect(within(screen.getByRole('list', { name: 'A1 units' })).getAllByRole('link')).toHaveLength(12);
    expect(screen.queryByText(/Preview —/)).not.toBeInTheDocument();
  });

  it('a learner placed in A2 lands on the A2 preview', async () => {
    await updateSettings({ level: 'A2', startUnit: 2 });
    renderAt('/learn');
    expect(await screen.findByText('Preview — 3 of 12 units')).toBeVisible();
    const cards = within(screen.getByRole('list', { name: 'A2 units' })).getAllByRole('listitem');
    expect(cards[1]).toHaveTextContent('Start here');
  });
});
