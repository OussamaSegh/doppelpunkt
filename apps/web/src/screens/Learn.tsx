import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { LEVELS, type CompiledUnit, type Level } from '@doppelpunkt/content-schema';
import { unitProgress } from '@doppelpunkt/engine';
import { ContentGate } from '../components/ContentGate';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';
import { findPack, useContent } from '../content';
import { db, todayKey, type AttemptRow, type UnitStatusRow } from '../db';
import { useAttempts, useSettings } from '../lib/hooks';

export function Learn() {
  return (
    <ContentGate>
      <LevelOverview />
    </ContentGate>
  );
}

function isLevel(v: string | undefined): v is Level {
  return !!v && (LEVELS as readonly string[]).includes(v);
}

function LevelOverview() {
  const params = useParams();
  const settings = useSettings();
  const packs = useContent((s) => s.packs);
  const attempts = useAttempts();
  const statuses = useLiveQuery(() => db.unitStatus.toArray(), []);
  const level: Level = isLevel(params.level) ? params.level : (settings?.level ?? 'A1');
  const pack = findPack(packs, level) ?? (isLevel(params.level) ? undefined : packs[0]);
  const available = new Set(packs.map((p) => p.level));

  return (
    <div className="space-y-5">
      <TodayCard />
      <nav aria-label="Levels" className="flex gap-2 overflow-x-auto pb-1">
        {LEVELS.map((l) =>
          available.has(l) ? (
            <Link
              key={l}
              to={`/learn/${l}`}
              aria-current={pack?.level === l ? 'page' : undefined}
              className={`chip font-semibold ${pack?.level === l ? 'border-accent bg-accent text-white dark:text-ink' : 'bg-surface'}`}
            >
              {l}
            </Link>
          ) : (
            <span key={l} className="chip cursor-not-allowed text-muted opacity-60" title="Coming soon" aria-disabled="true">
              {l}
            </span>
          ),
        )}
      </nav>

      {!pack ? (
        <EmptyState title={`${level} is not available yet`}>Lessons for this level are still being written.</EmptyState>
      ) : (
        <>
        <ol className="space-y-3" aria-label={`${pack.level} units`}>
          {pack.units.map((u) => (
            <li key={u.id}>
              <UnitCard
                unit={u}
                attempts={attempts ?? []}
                status={statuses?.find((s) => s.unitId === u.id)}
                suggested={settings?.level === u.level && settings.startUnit === u.number}
              />
            </li>
          ))}
        </ol>
        <Link to="/grammar" className="card flex items-center justify-between gap-3 py-3 transition-colors hover:border-accent">
          <span>
            <span className="block font-semibold">Grammar reference</span>
            <span className="block text-sm text-muted">Look up any grammar point from your lessons.</span>
          </span>
          <span aria-hidden="true" className="text-accent">→</span>
        </Link>
        </>
      )}
    </div>
  );
}

function UnitCard({ unit, attempts, status, suggested }: { unit: CompiledUnit; attempts: AttemptRow[]; status?: UnitStatusRow; suggested: boolean }) {
  const p = unitProgress(unit, attempts);
  const value = p.total ? p.done / p.total : 0;
  return (
    <Link to={`/unit/${unit.id}`} className="card block transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {unit.level} · Unit {unit.number}
            {suggested && <span className="ml-2 rounded bg-gold-soft px-1.5 text-gold-strong">Start here</span>}
            {status?.completedAt && <span className="ml-2 rounded bg-ok-soft px-1.5 text-ok">Done</span>}
          </p>
          <h2 lang="de" className="truncate text-lg font-semibold">
            {unit.title}
          </h2>
          <p className="text-sm text-muted">{unit.titleEn}</p>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted">
          {p.done}/{p.total}
        </span>
      </div>
      <div className="mt-3">
        <ProgressBar value={value} label={`${unit.title} progress`} />
      </div>
    </Link>
  );
}

function TodayCard() {
  const settings = useSettings();
  const today = useLiveQuery(() => db.activity.get(todayKey()), []);
  const due = useLiveQuery(() => db.cards.where('due').belowOrEqual(new Date().toISOString()).count(), []);
  const goal = settings?.dailyGoalMin ?? 10;
  const minutes = Math.round((today?.seconds ?? 0) / 60);
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3" aria-label="Today">
      <div className="min-w-40 flex-1">
        <p className="text-sm text-muted">Today</p>
        <p className="text-lg font-semibold">
          {minutes} / {goal} min
        </p>
        <ProgressBar value={minutes / goal} label="Daily goal" tone="gold" />
      </div>
      {!!due && (
        <Link to="/review" className="btn-secondary">
          Review {due} card{due === 1 ? '' : 's'}
        </Link>
      )}
    </section>
  );
}
