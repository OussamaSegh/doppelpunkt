import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Level, LevelPack } from '@doppelpunkt/content-schema';
import { MASTERED_SCORE, PASS_SCORE, placeLearner, placementItems } from '@doppelpunkt/engine';
import { ContentGate } from '../components/ContentGate';
import { ProgressBar } from '../components/ProgressBar';
import { findUnit, useContent } from '../content';
import { updateSettings, type PlacementResult } from '../db';
import { ExercisePlayer } from '../exercise/ExercisePlayer';
import { explainPlacement, levelScores, PLACEMENT_ITEMS, SECONDS_PER_ITEM, verdicts, type LevelVerdict } from '../lib/placement';

export function Placement() {
  return (
    <ContentGate>
      <PlacementTest />
    </ContentGate>
  );
}

type Result = { level: Level; score: number };

function unitsPerLevel(packs: LevelPack[]): Partial<Record<Level, number>> {
  return Object.fromEntries(packs.map((pk) => [pk.level, pk.units.length]));
}

function PlacementTest() {
  const packs = useContent((s) => s.packs);
  const items = useMemo(
    () =>
      placementItems(packs, PLACEMENT_ITEMS)
        .map((ex) => ({ ex, unit: findUnit(packs, ex.unitId) }))
        .filter((x): x is { ex: typeof x.ex; unit: NonNullable<typeof x.unit> } => !!x.unit),
    [packs],
  );
  const sections = useMemo(() => [...new Set(items.map((i) => i.ex.level))], [items]);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [answered, setAnswered] = useState(false);
  const [placed, setPlaced] = useState<PlacementResult>();
  const startedAt = useRef(0);

  const finish = async (all: Result[], stoppedEarly: boolean) => {
    const p = placeLearner(all, unitsPerLevel(packs));
    const result: PlacementResult = {
      at: new Date().toISOString(),
      level: p.level,
      unit: p.unit,
      perLevel: levelScores(all),
      answered: all.length,
      total: items.length,
      durationSec: Math.round((Date.now() - startedAt.current) / 1000),
      stoppedEarly,
    };
    await updateSettings({ level: p.level, startUnit: p.unit, placement: result });
    setPlaced(result);
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

  if (placed) return <PlacementResults result={placed} packs={packs} />;

  if (!started) {
    const minutes = Math.round((items.length * SECONDS_PER_ITEM) / 60);
    return (
      <section className="card space-y-4" aria-labelledby="placement-title">
        <h1 id="placement-title" className="text-2xl font-bold">
          Placement test
        </h1>
        <p>
          {items.length} questions in {sections.length} section{sections.length === 1 ? '' : 's'} ({sections.join(', ')}), about {minutes} minutes.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Each section is one level, easiest first. If a level is clearly too hard, the test ends there.</li>
          <li>You won't see the answers during the test, so just do your best. Guessing is fine.</li>
          <li>You can stop at any time; we'll place you with what you've answered.</li>
        </ul>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            startedAt.current = Date.now();
            setStarted(true);
          }}
        >
          Start the test
        </button>
      </section>
    );
  }

  const current = items[index];
  if (!current) return null;
  const level = current.ex.level;
  const sectionNo = sections.indexOf(level) + 1;
  const inSection = items.filter((i) => i.ex.level === level);
  const posInSection = inSection.indexOf(current) + 1;
  const minutesLeft = Math.max(1, Math.round(((items.length - index) * SECONDS_PER_ITEM) / 60));

  const next = () => {
    if (!answered) return;
    setAnswered(false);
    const nextItem = items[index + 1];
    if (!nextItem) return void finish(results, false);
    // Adaptive stop: at the end of a level that wasn't passed, higher levels can't count.
    if (nextItem.ex.level !== level) {
      const s = levelScores(results).find((x) => x.level === level);
      if (s && s.score < PASS_SCORE) return void finish(results, true);
    }
    setIndex(index + 1);
  };

  return (
    <section className="space-y-4" aria-labelledby="placement-title">
      <div className="flex items-center justify-between gap-2">
        <h1 id="placement-title" className="text-xl font-bold">
          Placement test
        </h1>
        <span className="text-sm text-muted">
          {index + 1} / {items.length}
        </span>
      </div>
      <ol className="flex gap-1.5" aria-label="Sections">
        {sections.map((l, i) => (
          <li
            key={l}
            aria-current={l === level ? 'step' : undefined}
            className={`chip text-xs font-semibold ${l === level ? 'border-accent bg-accent text-white dark:text-ink' : i < sectionNo - 1 ? 'bg-ok-soft text-ok' : 'bg-surface text-muted'}`}
          >
            {l}
          </li>
        ))}
      </ol>
      <ProgressBar value={index / items.length} label="Placement progress" />
      <p className="flex justify-between text-xs text-muted">
        <span>
          Section {sectionNo} of {sections.length}: {level} · question {posInSection} of {inSection.length}
        </span>
        <span>about {minutesLeft} min left</span>
      </p>
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
        onNext={next}
      />
      <div className="flex justify-between">
        <button type="button" className="btn-ghost" onClick={() => void finish(results, true)}>
          Stop here
        </button>
        <button type="button" className="btn-primary" disabled={!answered} onClick={next}>
          {index + 1 < items.length ? 'Next' : 'See result'}
        </button>
      </div>
    </section>
  );
}

const VERDICT_TONE: Record<LevelVerdict, string> = {
  mastered: 'text-ok',
  passed: 'text-ok',
  'not passed': 'text-bad',
  'not counted': 'text-muted',
};

export function PlacementResults({ result, packs }: { result: PlacementResult; packs: LevelPack[] }) {
  const navigate = useNavigate();
  const perLevel = unitsPerLevel(packs);
  const lines = explainPlacement(result.perLevel, result, perLevel);
  const unit = packs.find((p) => p.level === result.level)?.units.find((u) => u.number === result.unit);
  const startHere = () => navigate(unit ? `/unit/${unit.id}` : `/learn/${result.level}`);
  const fromStart = async () => {
    await updateSettings({ level: 'A1', startUnit: 1 });
    navigate('/learn/A1');
  };

  return (
    <section className="card space-y-4" aria-labelledby="placement-result" aria-live="polite">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Placement result</p>
        <h1 id="placement-result" className="text-2xl font-bold">
          Your starting point: {result.level}, unit {result.unit}
        </h1>
        {unit && (
          <p className="text-muted">
            <span lang="de">{unit.title}</span> · {unit.titleEn}
          </p>
        )}
      </div>

      <div className="space-y-2 text-sm">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>

      {result.perLevel.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Score per level</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 font-medium">Level</th>
              <th scope="col" className="py-1 font-medium">Questions</th>
              <th scope="col" className="py-1 font-medium">Score</th>
              <th scope="col" className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {verdicts(result.perLevel).map((s) => (
              <tr key={s.level} className="border-t border-line">
                <td className="py-1 font-semibold">{s.level}</td>
                <td className="py-1 tabular-nums">{s.items}</td>
                <td className="py-1 tabular-nums">{Math.round(s.score * 100)}%</td>
                <td className={`py-1 ${VERDICT_TONE[s.verdict]}`}>{s.verdict}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-muted">
        {result.answered} of {result.total} questions answered
        {result.stoppedEarly ? ' (the test ended early)' : ''}. A level is passed at {Math.round(PASS_SCORE * 100)}% and mastered at {Math.round(MASTERED_SCORE * 100)}%.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={startHere}>
          Start here
        </button>
        {!(result.level === 'A1' && result.unit === 1) && (
          <button type="button" className="btn-secondary" onClick={() => void fromStart()}>
            Start from A1 unit 1 instead
          </button>
        )}
      </div>
    </section>
  );
}
