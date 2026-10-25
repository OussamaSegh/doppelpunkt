import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { CompiledUnit } from '@doppelpunkt/content-schema';
import { ContentGate } from '../components/ContentGate';
import { EmptyState } from '../components/EmptyState';
import { findPack, findUnit, useContent } from '../content';
import { useSettings, useUnitStatus } from '../lib/hooks';
import { markVisited } from '../lib/progress';
import { canOpenUnit, useEntitlements } from '../lib/billing/entitlements';
import { LockedNotice } from '../components/Lock';
import { CheckStep, EinstiegStep, GrammatikStep, LesenStep, SchwiizStep, UebungenStep, WortschatzStep } from './unit/steps';

export type StepId = 'einstieg' | 'wortschatz' | 'grammatik' | 'lesen' | 'uebungen' | 'schwiiz' | 'check';

const STEPS: Array<{ id: StepId; label: string; en: string; swiss?: boolean }> = [
  { id: 'einstieg', label: 'Einstieg', en: 'Intro' },
  { id: 'wortschatz', label: 'Wortschatz', en: 'Vocabulary' },
  { id: 'grammatik', label: 'Grammatik', en: 'Grammar' },
  { id: 'lesen', label: 'Lesen', en: 'Reading' },
  { id: 'uebungen', label: 'Übungen', en: 'Exercises' },
  { id: 'schwiiz', label: 'Schwiiz', en: 'Swiss lane', swiss: true },
  { id: 'check', label: 'Check', en: 'Self-check' },
];

export function stepsFor(unit: CompiledUnit) {
  return STEPS.filter((s) => s.id !== 'lesen' || unit.reading);
}

export function UnitView() {
  return (
    <ContentGate>
      <UnitScreen />
    </ContentGate>
  );
}

function UnitScreen() {
  const { unitId = '', step } = useParams();
  const packs = useContent((s) => s.packs);
  const settings = useSettings();
  const unit = findUnit(packs, unitId);
  const status = useUnitStatus(unitId);
  const ent = useEntitlements();
  const allowed = !!unit && ent.ready && canOpenUnit(unit, ent);

  const steps = unit ? stepsFor(unit) : [];
  const current = steps.find((s) => s.id === step);

  useEffect(() => {
    if (unit && current && allowed) void markVisited(unit, current.id);
  }, [unit, current, allowed]);

  if (!unit) {
    return (
      <EmptyState headingLevel={1} title="Unit not found" action={<Link className="btn-primary" to="/learn">Back to Learn</Link>}>
        "{unitId}" isn't in the installed lessons.
      </EmptyState>
    );
  }
  if (!ent.ready) return <p role="status">Checking your unlocks…</p>;
  if (!allowed) return <LockedNotice level={unit.level} what={`Unit ${unit.number}`} />;
  if (!current) return <Navigate to={`/unit/${unit.id}/einstieg`} replace />;

  let body: ReactNode;
  switch (current.id) {
    case 'einstieg':
      body = <EinstiegStep unit={unit} />;
      break;
    case 'wortschatz':
      body = <WortschatzStep unit={unit} />;
      break;
    case 'grammatik':
      body = <GrammatikStep unit={unit} />;
      break;
    case 'lesen':
      body = <LesenStep unit={unit} />;
      break;
    case 'uebungen':
      body = <UebungenStep unit={unit} />;
      break;
    case 'schwiiz':
      body = <SchwiizStep unit={unit} dialect={settings?.dialect ?? 'gsw-zh'} />;
      break;
    case 'check':
      body = <CheckStep unit={unit} pack={findPack(packs, unit.level)} />;
      break;
  }

  const idx = steps.indexOf(current);
  const nextStep = steps[idx + 1];

  return (
    <div className="space-y-4">
      <header>
        <Link to={`/learn/${unit.level}`} className="text-sm text-accent hover:underline">
          ← {unit.level}
        </Link>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">Unit {unit.number}</p>
        <h1 lang="de" className="text-2xl font-bold">
          {unit.title}
        </h1>
        <p className="text-muted">{unit.titleEn}</p>
        <ReviewNote unit={unit} />
      </header>

      <nav aria-label="Unit steps" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex w-max gap-1.5 pb-1">
          {steps.map((s) => {
            const active = s.id === current.id;
            const visited = status?.visited.includes(s.id);
            return (
              <li key={s.id}>
                <Link
                  to={`/unit/${unit.id}/${s.id}`}
                  aria-current={active ? 'page' : undefined}
                  title={s.en}
                  className={`chip whitespace-nowrap ${
                    active
                      ? s.swiss
                        ? 'border-swiss bg-swiss text-white dark:text-ink'
                        : 'border-ink bg-ink text-white dark:border-accent dark:bg-accent dark:text-ink'
                      : s.swiss
                        ? 'border-swiss/40 text-swiss-strong'
                        : 'bg-surface'
                  }`}
                >
                  {visited && !active && <span aria-hidden="true">✓ </span>}
                  <span lang="de">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-label={current.en}>{body}</section>

      {nextStep && (
        <div className="flex justify-end">
          <Link className="btn-secondary" to={`/unit/${unit.id}/${nextStep.id}`}>
            Next: <span lang="de">{nextStep.label}</span> →
          </Link>
        </div>
      )}
    </div>
  );
}

/** Subtle note on units whose German and Swiss content hasn't been signed off by native speakers yet. */
export function ReviewNote({ unit }: { unit: Pick<CompiledUnit, 'review'> }) {
  const de = !!unit.review?.de;
  const ch = !!unit.review?.ch;
  if (de && ch) {
    return (
      <p className="mt-1 text-xs text-muted">
        <span aria-hidden="true">✓ </span>Checked by native speakers{unit.review?.date ? ` (${unit.review.date})` : ''}
      </p>
    );
  }
  const missing = !de && !ch ? '' : !de ? ' (Standard German check pending)' : ' (Swiss German check pending)';
  return (
    <p className="mt-1 text-xs text-muted" title="A German teacher and a Swiss native check every unit before v1.0.">
      <span aria-hidden="true">ⓘ </span>Not yet reviewed by a native speaker{missing}
    </p>
  );
}
