import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { errorProfile, estimateSkills } from '@doppelpunkt/engine';
import { SkillRadar, skillLabel } from '../components/SkillRadar';
import { allUnits, useContent } from '../content';
import { db, type PlacementResult } from '../db';
import { useAttempts, useSettings } from '../lib/hooks';
import { studyStreak, weekMinutes } from '../lib/progress';

export function Progress() {
  const attempts = useAttempts();
  const activity = useLiveQuery(() => db.activity.toArray(), []);
  const statuses = useLiveQuery(() => db.unitStatus.toArray(), []);
  const settings = useSettings();
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
  const started = allUnits(packs).filter((u) => statuses.some((s) => s.unitId === u.id));

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

      <section className="card" aria-labelledby="cando-title">
        <h2 id="cando-title" className="mb-2 font-semibold">
          Can-do statements
        </h2>
        {started.length === 0 ? (
          <p className="text-sm text-muted">
            Start a unit on the <Link className="text-accent underline" to="/learn">Learn</Link> tab.
          </p>
        ) : (
          <div className="space-y-3">
            {started.map((u) => {
              const st = statuses.find((s) => s.unitId === u.id);
              return (
                <div key={u.id}>
                  <Link to={`/unit/${u.id}/check`} className="font-medium text-accent hover:underline">
                    {u.level} · {u.number}. <span lang="de">{u.title}</span>
                  </Link>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {u.canDo.map((c, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden="true" className={st?.canDo[i] ? 'text-ok' : 'text-muted'}>
                          {st?.canDo[i] ? '✓' : '○'}
                        </span>
                        <span className={st?.canDo[i] ? '' : 'text-muted'}>{c}</span>
                        <span className="sr-only">{st?.canDo[i] ? '(done)' : '(not yet)'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
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
