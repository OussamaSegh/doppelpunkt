import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { errorProfile, estimateSkills } from '@doppelpunkt/engine';
import { SkillRadar, skillLabel } from '../components/SkillRadar';
import type { LevelPack } from '@doppelpunkt/content-schema';
import { allUnits, useContent, useEnsureContent } from '../content';
import { db, type AttemptRow, type ExamResultRow, type PlacementResult, type UnitStatusRow } from '../db';
import { canDoChecklist, CHECK_COVERAGE, CHECK_PASS_SCORE, levelMilestone, UNITS_PER_LEVEL } from '../lib/cando';
import { latestPerLevel, SKILL_NAME } from '../lib/exam';
import { useAttempts, useSettings } from '../lib/hooks';
import { setCanDo, studyStreak, weekMinutes } from '../lib/progress';

export function Progress() {
  const attempts = useAttempts();
  const activity = useLiveQuery(() => db.activity.toArray(), []);
  const statuses = useLiveQuery(() => db.unitStatus.toArray(), []);
  const examResults = useLiveQuery(() => db.examResults.toArray(), []);
  const settings = useSettings();
  useEnsureContent();
  const packs = useContent((s) => s.packs);

  const skills = useMemo(() => estimateSkills(attempts ?? []), [attempts]);
  const errors = useMemo(() => errorProfile(attempts ?? []).slice(0, 10), [attempts]);
  const grammarTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of allUnits(packs)) for (const g of u.grammar) m.set(g.id, g.title);
    return m;
  }, [packs]);

  if (!attempts || !activity || !statuses) return <p role="status">Loading progress…</p>;

  const days = weekMinutes(activity);
  const goal = settings?.dailyGoalMin ?? 10;
  const maxMin = Math.max(goal, ...days.map((d) => d.minutes));
  const total = days.reduce((a, d) => a + d.minutes, 0);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">Progress</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Streak" value={`${studyStreak(activity, attempts)} days`} />
        <Stat label="This week" value={`${total} min`} />
        <Stat label="Exercises answered" value={String(attempts.length)} />
      </div>

      <PlacementCard placement={settings?.placement} />

      <section className="card" aria-labelledby="week-title">
        <h2 id="week-title" className="mb-3 font-semibold">
          Minutes per day
        </h2>
        <ul className="flex h-32 items-end gap-2" aria-label={`Daily goal ${goal} minutes`}>
          {days.map((d) => (
            <li key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted">{d.minutes}</span>
              <span
                className={`w-full rounded-t-md ${d.minutes >= goal ? 'bg-gold' : 'bg-accent/60'}`}
                style={{ height: `${Math.max(2, (d.minutes / maxMin) * 88)}px` }}
                aria-label={`${d.label}: ${d.minutes} minutes`}
              />
              <span className="text-[11px] text-muted">{d.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="skills-title">
        <h2 id="skills-title" className="mb-2 font-semibold">
          Skills
        </h2>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">Answer some exercises to see your skill profile.</p>
        ) : (
          <>
            <SkillRadar skills={skills} />
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Estimated CEFR band per skill</caption>
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 font-medium">Skill</th>
                  <th scope="col" className="py-1 font-medium">Band</th>
                  <th scope="col" className="py-1 font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.skill} className="border-t border-line">
                    <td className={`py-1 ${s.skill === 'swiss' ? 'text-swiss-strong' : ''}`}>{skillLabel(s.skill)}</td>
                    <td className="py-1 font-semibold">{s.attempts ? s.band : '–'}</td>
                    <td className="py-1 tabular-nums">{s.attempts ? `${Math.round(s.confidence * 100)}% (${s.attempts})` : 'no data'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="errors-title">
        <h2 id="errors-title" className="mb-2 font-semibold">
          What to work on
        </h2>
        {errors.length === 0 ? (
          <p className="text-sm text-muted">No recurring mistakes yet.</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {errors.map((e) => (
              <li key={e.key} className="flex justify-between gap-2 border-b border-line py-1 last:border-0">
                <span>{grammarTitles.get(e.key) ?? e.key}</span>
                <span className="tabular-nums text-muted">{e.count}×</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {packs.map((pack) => (
        <LevelChecklist key={pack.level} pack={pack} attempts={attempts} statuses={statuses} results={examResults ?? []} />
      ))}
    </div>
  );
}

function LevelChecklist({ pack, attempts, statuses, results }: { pack: LevelPack; attempts: AttemptRow[]; statuses: UnitStatusRow[]; results: ExamResultRow[] }) {
  const list = useMemo(() => canDoChecklist(pack, attempts, statuses), [pack, attempts, statuses]);
  const levelResults = results.filter((r) => r.level === pack.level);
  const latest = latestPerLevel(levelResults).get(pack.level);
  const passedOnce = levelResults.some((r) => r.passed);
  const m = levelMilestone(pack, statuses, list, passedOnce);
  const exam = latest ? pack.exams.find((e) => e.id === latest.examId) : undefined;
  return (
    <>
      <section className={`card space-y-2 ${m.complete ? 'border-gold bg-gold-soft' : ''}`} aria-labelledby={`milestone-${pack.level}`}>
        <h2 id={`milestone-${pack.level}`} className="font-semibold">
          {m.complete ? `${pack.level} complete` : `Towards ${pack.level} complete`}
        </h2>
        {m.complete ? (
          <p className="text-sm">
            <span aria-hidden="true">★ </span>Herzlichen Glückwunsch! You finished all {m.units} {pack.level} units and passed the mock exam. You can do everything on the {pack.level} list below.
          </p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            <MilestoneLine done={m.allUnitsDone}>
              Units marked as done: {m.unitsDone} of {UNITS_PER_LEVEL}
              {m.units < UNITS_PER_LEVEL ? ` (${m.units} installed so far)` : ''}
            </MilestoneLine>
            <MilestoneLine done={m.examPassed}>
              {pack.level} mock exam {m.examPassed ? 'passed' : m.hasExam ? 'not passed yet' : 'coming soon'}
            </MilestoneLine>
          </ul>
        )}
        <p className="text-xs text-muted">
          Can-do statements: {m.canDoDone} of {m.canDoTotal}
        </p>
      </section>

      <section className="card space-y-2" aria-labelledby={`exam-card-${pack.level}`}>
        <h2 id={`exam-card-${pack.level}`} className="font-semibold">
          {pack.level} mock exam
        </h2>
        {latest ? (
          <>
            <p className="text-sm">
              Latest: <span className="font-semibold">{latest.points} of {latest.max} points</span> ({Math.round((latest.points / Math.max(1, latest.max)) * 100)}%),{' '}
              <span className={latest.passed ? 'text-ok' : 'text-bad'}>{latest.passed ? 'passed' : 'not passed'}</span> on{' '}
              {new Date(latest.at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}.
            </p>
            {exam && (
              <ul className="flex flex-wrap gap-2 text-sm" aria-label="Mock exam points per section">
                {exam.sections.map((s) => {
                  const r = latest.sections.find((x) => x.sectionId === s.id);
                  return (
                    <li key={s.id} className="chip bg-surface">
                      <span lang="de" className="font-semibold">{SKILL_NAME[s.skill].de}</span>&nbsp;{r?.points ?? 0}/{r?.max ?? 0}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="flex flex-wrap gap-x-4 text-sm">
              <Link to={`/exam/${latest.examId}?result=${latest.id}`} className="text-accent hover:underline">
                Review the answers
              </Link>
              <Link to={`/exam/${latest.examId}`} className="text-accent hover:underline">
                Take it again
              </Link>
            </p>
          </>
        ) : pack.exams.length ? (
          <p className="text-sm text-muted">
            You haven't taken it yet.{' '}
            <Link to="/exam" className="text-accent underline">
              Take the {pack.level} mock exam
            </Link>{' '}
            when you've worked through the units.
          </p>
        ) : (
          <p className="text-sm text-muted">The {pack.level} mock exam is being written.</p>
        )}
      </section>

      <section className="card" aria-labelledby={`cando-${pack.level}`}>
        <h2 id={`cando-${pack.level}`} className="mb-1 font-semibold">
          {pack.level} can-do checklist
        </h2>
        <p className="mb-3 text-xs text-muted">
          Statements tick themselves when you pass a unit check (unit marked as done, at least {Math.round(CHECK_COVERAGE * 100)}% of its exercises tried,
          average {Math.round(CHECK_PASS_SCORE * 100)}% or more). You can also tick them yourself.
        </p>
        <div className="space-y-4">
          {list.map(({ unit, check, items }) => (
            <fieldset key={unit.id}>
              <legend className="font-medium">
                <Link to={`/unit/${unit.id}/check`} className="text-accent hover:underline">
                  {unit.level} · {unit.number}. <span lang="de">{unit.title}</span>
                </Link>
                {check.passed && <span className="ml-2 rounded bg-ok-soft px-1.5 text-xs text-ok">Check passed</span>}
              </legend>
              <ul className="mt-1 space-y-1 text-sm">
                {items.map((it) => (
                  <li key={it.index}>
                    <label className="flex min-h-6 items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-5 w-5 shrink-0"
                        checked={it.done}
                        disabled={it.auto}
                        aria-describedby={it.auto ? `auto-${unit.id}` : undefined}
                        onChange={(e) => void setCanDo(unit, it.index, e.target.checked)}
                      />
                      <span className={it.done ? '' : 'text-muted'}>{it.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {check.passed && (
                <p id={`auto-${unit.id}`} className="mt-1 text-xs text-muted">
                  Ticked because you passed the unit check.
                </p>
              )}
            </fieldset>
          ))}
        </div>
      </section>
    </>
  );
}

function MilestoneLine({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden="true" className={done ? 'text-ok' : 'text-muted'}>
        {done ? '✓' : '○'}
      </span>
      <span>{children}</span>
      <span className="sr-only">{done ? '(done)' : '(not yet)'}</span>
    </li>
  );
}

function PlacementCard({ placement }: { placement?: PlacementResult }) {
  return (
    <section className="card space-y-2" aria-labelledby="placement-title">
      <h2 id="placement-title" className="font-semibold">
        Placement test
      </h2>
      {placement ? (
        <>
          <p className="text-sm">
            Placed at <span className="font-semibold">{placement.level}, unit {placement.unit}</span> on{' '}
            {new Date(placement.at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}
            {placement.stoppedEarly ? ' (ended early)' : ''}.
          </p>
          {placement.perLevel.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm" aria-label="Placement score per level">
              {placement.perLevel.map((l) => (
                <li key={l.level} className="chip bg-surface">
                  <span className="font-semibold">{l.level}</span>&nbsp;{Math.round(l.score * 100)}%
                </li>
              ))}
            </ul>
          )}
          <Link to="/placement" className="text-sm text-accent hover:underline">
            Take the test again
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted">
          You haven't taken it.{' '}
          <Link to="/placement" className="text-accent underline">
            Take the placement test
          </Link>{' '}
          to find the right starting unit.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
