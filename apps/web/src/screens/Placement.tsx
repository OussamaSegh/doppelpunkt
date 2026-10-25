import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Level } from '@doppelpunkt/content-schema';
import { placeLearner, placementItems } from '@doppelpunkt/engine';
import { ContentGate } from '../components/ContentGate';
import { ProgressBar } from '../components/ProgressBar';
import { findUnit, useContent } from '../content';
import { updateSettings } from '../db';
import { ExercisePlayer } from '../exercise/ExercisePlayer';

export function Placement() {
  return (
    <ContentGate>
      <PlacementTest />
    </ContentGate>
  );
}

function PlacementTest() {
  const packs = useContent((s) => s.packs);
  const navigate = useNavigate();
  const items = useMemo(
    () =>
      placementItems(packs, 15)
        .map((ex) => ({ ex, unit: findUnit(packs, ex.unitId) }))
        .filter((x): x is { ex: typeof x.ex; unit: NonNullable<typeof x.unit> } => !!x.unit),
    [packs],
  );
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Array<{ level: Level; score: number }>>([]);
  const [answered, setAnswered] = useState(false);
  const [placed, setPlaced] = useState<{ level: Level; unit: number }>();

  const finish = async (all: Array<{ level: Level; score: number }>) => {
    const unitsPerLevel = Object.fromEntries(packs.map((pk) => [pk.level, pk.units.length]));
    const p = placeLearner(all, unitsPerLevel);
    await updateSettings({ level: p.level, startUnit: p.unit });
    setPlaced(p);
  };

  if (!items.length) {
    return (
      <div className="card space-y-3">
        <p>There are not enough lessons installed for a placement test yet.</p>
        <Link to="/learn" className="btn-primary">
          Start at A1
        </Link>
      </div>
    );
  }

  if (placed) {
    return (
      <section className="card space-y-4 text-center" aria-live="polite">
        <h1 className="text-2xl font-bold">Your starting point: {placed.level}</h1>
        <p className="text-muted">We suggest starting with unit {placed.unit}. Earlier units stay open for revision.</p>
        <button type="button" className="btn-primary" onClick={() => navigate(`/learn/${placed.level}`)}>
          Go to {placed.level}
        </button>
      </section>
    );
  }

  const current = items[index];
  if (!current) return null;
  const next = () => {
    setAnswered(false);
    if (index + 1 < items.length) setIndex(index + 1);
    else void finish(results);
  };

  return (
    <section className="space-y-4" aria-labelledby="placement-title">
      <div className="flex items-center justify-between">
        <h1 id="placement-title" className="text-xl font-bold">
          Placement test
        </h1>
        <span className="text-sm text-muted">
          {index + 1} / {items.length}
        </span>
      </div>
      <ProgressBar value={index / items.length} label="Placement progress" />
      <ExercisePlayer
        key={current.ex.id}
        exercise={current.ex}
        unit={current.unit}
        record={false}
        showFeedback={false}
        onDone={(o) => {
          setResults((r) => [...r, { level: current.ex.level, score: o.score }]);
          setAnswered(true);
        }}
      />
      <div className="flex justify-between">
        <button type="button" className="btn-ghost" onClick={() => void finish(results)}>
          Stop here
        </button>
        <button type="button" className="btn-primary" disabled={!answered} onClick={next}>
          {index + 1 < items.length ? 'Next' : 'See result'}
        </button>
      </div>
    </section>
  );
}
