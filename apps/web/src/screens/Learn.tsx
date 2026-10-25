import { lazy, Suspense } from 'react';
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
import { betaActive } from '../lib/beta/config';
import { UNITS_PER_LEVEL } from '../lib/cando';
import { canOpenLevel, canOpenUnit, useEntitlements, type EntitlementState } from '../lib/billing/entitlements';
import { LockIcon } from '../components/Lock';

// Beta builds only; loaded on demand so it costs nothing in the initial bundle.
const BetaIntroCard = lazy(() => import('../beta/BetaIntroCard').then((m) => ({ default: m.BetaIntroCard })));

export function Learn() {
  return (
    <ContentGate>
      <LevelOverview />
    </ContentGate>
  );
}

/** A level whose pack has fewer units than the syllabus (12): shown as a usable preview. */
export function isPreview(pack: { units: unknown[] }): boolean {
  return pack.units.length < UNITS_PER_LEVEL;
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
  const ent = useEntitlements();
  // While the tokens are being checked (a few ms), show nothing as locked rather than flash locks.
  const locked = (l: string) => ent.ready && !canOpenLevel(l, ent);

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Learn {pack?.level ?? level}</h1>
      {betaActive() && settings?.onboarded && !settings.beta?.introDone && (
        <Suspense fallback={null}>
          <BetaIntroCard beta={{ stats: false, crashes: false, ...settings.beta }} />
        </Suspense>
      )}
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
              {isPreview(packs.find((p) => p.level === l)!) && <span className="ml-1 text-[10px] font-medium uppercase tracking-wide">preview</span>}
              {locked(l) && (
                <span className="ml-1 inline-flex items-center">
                  <LockIcon />
                  <span className="sr-only">locked</span>
                </span>
              )}
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
        {isPreview(pack) && (
          <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent" role="note">
            <span className="font-semibold">
              Preview — {pack.units.length} of {UNITS_PER_LEVEL} units
            </span>
            . More {pack.level} units are on the way; these are ready to use.
          </p>
        )}
        {locked(pack.level) && <LockedLevelNote level={pack.level} />}
        <ol className="space-y-3" aria-label={`${pack.level} units`}>
          {pack.units.map((u) => (
            <li key={u.id}>
              <UnitCard
                unit={u}
                attempts={attempts ?? []}
                status={statuses?.find((s) => s.unitId === u.id)}
                suggested={settings?.level === u.level && settings.startUnit === u.number}
                ent={ent}
              />
            </li>
          ))}
        </ol>
        {pack.exams.length > 0 && (
          <Link to="/exam" className="card flex items-center justify-between gap-3 border-gold/50 py-3 transition-colors hover:border-accent">
            <span>
              <span className="flex items-center gap-1.5 font-semibold">
                {pack.level} mock exam
                {locked(pack.level) && (
                  <>
                    <LockIcon />
                    <span className="sr-only">(locked)</span>
                  </>
                )}
              </span>
              <span className="block text-sm text-muted">
                Timed practice in the exam format: <span lang="de">Hören, Lesen, Schreiben, Sprechen</span>.
              </span>
            </span>
            <span aria-hidden="true" className="text-accent">→</span>
          </Link>
        )}
        <Link to="/grammar" className="card flex items-center justify-between gap-3 py-3 transition-colors hover:border-accent">
          <span>
            <span className="block font-semibold">Grammar reference</span>
            <span className="block text-sm text-muted">Look up any grammar point from your lessons.</span>
          </span>
          <span aria-hidden="true" className="text-accent">→</span>
        </Link>
        {betaActive() && (
          <Link to="/beta" className="card flex items-center justify-between gap-3 py-3 transition-colors hover:border-accent">
            <span>
              <span className="block font-semibold">Beta feedback</span>
              <span className="block text-sm text-muted">What's new, how to report a problem, and your reports.</span>
            </span>
            <span aria-hidden="true" className="text-accent">→</span>
          </Link>
        )}
        <Link to="/pronunciation" className="card flex items-center justify-between gap-3 py-3 transition-colors hover:border-accent">
          <span>
            <span className="block font-semibold">Pronunciation drills</span>
            <span className="block text-sm text-muted">ü and ö, ich- and ach-Laut, the German r, Swiss ch and more.</span>
          </span>
          <span aria-hidden="true" className="text-accent">→</span>
        </Link>
        </>
      )}
    </div>
  );
}

/** On a level that needs an unlock: unit 1 is a free preview. */
function LockedLevelNote({ level }: { level: string }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 border-gold/50 py-3" role="note" aria-label={`${level} is locked`}>
      <p className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        <LockIcon className="mt-0.5 h-4 w-4 text-gold-strong" />
        <span>
          <span className="font-semibold">{level} is locked.</span> Unit 1 is a free preview. Unlock {level} for every unit and the mock exam; it
          works offline once unlocked.
        </span>
      </p>
      <Link to={`/unlock/${level}`} className="btn-primary">
        Unlock {level}
      </Link>
    </div>
  );
}

function UnitCard({
  unit,
  attempts,
  status,
  suggested,
  ent,
}: {
  unit: CompiledUnit;
  attempts: AttemptRow[];
  status?: UnitStatusRow;
  suggested: boolean;
  ent: EntitlementState;
}) {
  const p = unitProgress(unit, attempts);
  const value = p.total ? p.done / p.total : 0;
  const levelLocked = ent.ready && !canOpenLevel(unit.level, ent);
  const locked = ent.ready && !canOpenUnit(unit, ent);
  return (
    <Link to={`/unit/${unit.id}`} className={`card block transition-colors hover:border-accent ${locked ? 'opacity-80' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {unit.level} · Unit {unit.number}
            {suggested && <span className="ml-2 rounded bg-gold-soft px-1.5 text-gold-strong">Start here</span>}
            {status?.completedAt && <span className="ml-2 rounded bg-ok-soft px-1.5 text-ok">Done</span>}
            {levelLocked && !locked && <span className="ml-2 rounded bg-gold-soft px-1.5 text-gold-strong">Free preview</span>}
            {locked && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 text-muted">
                <LockIcon className="h-3 w-3" />
                Locked
              </span>
            )}
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
