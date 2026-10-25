// One mock exam: intro → timed sections → scoring of open tasks → results and review.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LevelPack, MockExam } from '@doppelpunkt/content-schema';
import { scoreExam, sectionPoints, type Answer, type GradeResult } from '@doppelpunkt/engine';
import { db, type ExamItemResult, type ExamResultRow, type ExamSectionResult } from '../../db';
import { answerText } from '../../exercise/types';
import { announcement, clock, examMinutes, examUnit, FORMAT_NAME, sectionMax, SKILL_NAME, spokenTime } from '../../lib/exam';
import { PageWideKeys } from '../../lib/keys';
import { ExamItem, Instructions, Stimulus, type Take } from './ExamItems';
import { ExamMarking, isOpenExercise, type Mark } from './ExamMarking';
import { ExamResults } from './ExamResults';
import { useCountdown } from './useCountdown';

type Phase = { kind: 'intro' } | { kind: 'section'; index: number } | { kind: 'marking' } | { kind: 'results'; row: ExamResultRow };

type SectionLog = { usedSec: number; timedOut: boolean };

export function ExamRun({ exam, pack }: { exam: MockExam; pack: LevelPack }) {
  const unit = useMemo(() => examUnit(exam, pack), [exam, pack]);
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [takes, setTakes] = useState<Record<string, Take>>({});
  const [notice, setNotice] = useState<string>();
  const log = useRef<Record<string, SectionLog>>({});
  const pausedSec = useRef(0);

  const openItems = useMemo(() => exam.sections.flatMap((s) => s.exercises).filter(isOpenExercise), [exam]);
  const pointsById = useMemo(
    () => Object.fromEntries(exam.sections.flatMap((s) => { const p = sectionPoints(s); return s.exercises.map((e, i) => [e.id, p[i] ?? 1] as const); })),
    [exam],
  );

  const onAnswer = useCallback((id: string, a: Answer | undefined) => {
    setAnswers((cur) => {
      const next = { ...cur };
      if (a === undefined) delete next[id];
      else next[id] = a;
      return next;
    });
  }, []);
  const onText = useCallback((id: string, t: string) => setTexts((cur) => ({ ...cur, [id]: t })), []);
  const onTake = useCallback((id: string, t: Take) => setTakes((cur) => ({ ...cur, [id]: t })), []);

  const reset = () => {
    setAnswers({});
    setTexts({});
    setTakes({});
    setNotice(undefined);
    log.current = {};
    pausedSec.current = 0;
    setPhase({ kind: 'intro' });
  };

  const endSection = (index: number, entry: SectionLog) => {
    const s = exam.sections[index];
    if (!s) return;
    log.current[s.id] = entry;
    const next = exam.sections[index + 1];
    setNotice(
      entry.timedOut
        ? `Time is up for ${s.title}. Your answers there are saved${next ? ` and the exam has moved on to ${next.title}` : ''}.`
        : undefined,
    );
    if (next) setPhase({ kind: 'section', index: index + 1 });
    else if (openItems.length) setPhase({ kind: 'marking' });
    else void finish({});
  };

  const finish = async (marks: Record<string, Mark>) => {
    const all = { ...answers };
    const openScores: Record<string, number> = {};
    for (const [id, m] of Object.entries(marks)) {
      if (m.openScore !== undefined) openScores[id] = m.openScore;
      if (m.transcript) all[id] = m.transcript;
    }
    const score = scoreExam(exam, all, openScores);
    const byId = new Map(exam.sections.flatMap((s) => s.exercises).map((e) => [e.id, e] as const));
    const items: ExamItemResult[] = score.items.map((it) => {
      const ex = byId.get(it.id)!;
      const m = marks[it.id];
      const raw = all[it.id];
      const answer = ex.type === 'write' || ex.type === 'roleplay' ? texts[it.id] : raw !== undefined ? answerText(ex, raw) : undefined;
      const method: ExamItemResult['method'] = m?.method ?? (raw === undefined ? 'unanswered' : 'auto');
      return {
        exerciseId: it.id,
        sectionId: it.section,
        points: it.points,
        max: it.max,
        score: it.max ? it.points / it.max : 0,
        method,
        ...(answer?.trim() ? { answer } : {}),
        ...(it.result ? { result: it.result as GradeResult } : {}),
        ...(m?.feedback ? { feedback: m.feedback } : {}),
        ...(m?.selfCheck ? { selfCheck: m.selfCheck } : {}),
      };
    });
    const sections: ExamSectionResult[] = score.sections.map((s) => ({
      sectionId: s.id,
      points: s.points,
      max: s.max,
      usedSec: Math.round(log.current[s.id]?.usedSec ?? 0),
      timedOut: log.current[s.id]?.timedOut ?? false,
    }));
    const row: ExamResultRow = {
      examId: exam.id,
      level: exam.level,
      at: new Date().toISOString(),
      points: score.total,
      max: score.max,
      passMark: exam.passMark,
      passed: score.passed,
      durationSec: sections.reduce((a, s) => a + s.usedSec, 0),
      pausedSec: Math.round(pausedSec.current),
      sections,
      items,
    };
    const id = await db.examResults.add(row);
    setNotice(undefined);
    setPhase({ kind: 'results', row: { ...row, id } });
  };

  // Reloading or closing the tab mid-exam would lose the answers: ask the browser to confirm.
  const running = phase.kind === 'section' || phase.kind === 'marking';
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  if (phase.kind === 'intro') return <ExamIntro exam={exam} onStart={() => setPhase({ kind: 'section', index: 0 })} />;
  if (phase.kind === 'results') return <ExamResults exam={exam} row={phase.row} pack={pack} onRetake={reset} />;

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Mock exam · practice</p>
        <h1 className="text-xl font-bold">{exam.title}</h1>
      </header>
      <ol className="flex flex-wrap gap-1.5" aria-label="Sections">
        {exam.sections.map((s, i) => {
          const current = phase.kind === 'section' && phase.index === i;
          const done = phase.kind === 'marking' || (phase.kind === 'section' && i < phase.index);
          return (
            <li
              key={s.id}
              aria-current={current ? 'step' : undefined}
              className={`chip text-xs font-semibold ${current ? 'border-accent bg-accent text-white dark:text-ink' : done ? 'bg-ok-soft text-ok' : 'bg-surface text-muted'}`}
            >
              <span lang="de">{SKILL_NAME[s.skill].de}</span>
              {done && <span className="sr-only"> (done)</span>}
            </li>
          );
        })}
      </ol>
      {notice && (
        <p role="status" className="rounded-xl border border-bad/40 bg-bad-soft px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {phase.kind === 'section' && (
        <SectionView
          key={exam.sections[phase.index]!.id}
          exam={exam}
          index={phase.index}
          unit={unit}
          answers={answers}
          texts={texts}
          takes={takes}
          onAnswer={onAnswer}
          onText={onText}
          onTake={onTake}
          onPaused={(sec) => (pausedSec.current += sec)}
          onEnd={(entry) => endSection(phase.index, entry)}
        />
      )}
      {phase.kind === 'marking' && (
        <ExamMarking items={openItems} points={pointsById} unit={unit} level={exam.level} texts={texts} takes={takes} onDone={(m) => void finish(m)} />
      )}
    </div>
  );
}

function ExamIntro({ exam, onStart }: { exam: MockExam; onStart: () => void }) {
  const max = exam.sections.reduce((a, s) => a + sectionMax(s), 0);
  return (
    <section className="card space-y-4" aria-labelledby="exam-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{exam.level} mock exam</p>
        <h1 id="exam-title" className="text-2xl font-bold">
          {exam.title}
        </h1>
      </div>
      <p>
        {exam.format === 'generic'
          ? 'Original practice items in the format of the A1 exams (Goethe, telc, ÖSD).'
          : `Original practice items in the format of the ${FORMAT_NAME[exam.format]} ${exam.level}.`}{' '}
        {exam.sections.length} sections, {examMinutes(exam)} minutes in total, {max} points. You pass with {Math.round(exam.passMark * 100)}% (
        {Math.round(exam.passMark * max * 10) / 10} points).
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Sections</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 font-medium">Section</th>
            <th scope="col" className="py-1 font-medium">Items</th>
            <th scope="col" className="py-1 font-medium">Points</th>
            <th scope="col" className="py-1 font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {exam.sections.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <th scope="row" className="py-1 text-left font-semibold">
                <span lang="de">{SKILL_NAME[s.skill].de}</span> <span className="font-normal text-muted">({SKILL_NAME[s.skill].en})</span>
              </th>
              <td className="py-1 tabular-nums">{s.exercises.length}</td>
              <td className="py-1 tabular-nums">{sectionMax(s)}</td>
              <td className="py-1 tabular-nums">{s.minutes} min</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>Each section has its own clock. When it runs out, the exam moves on to the next section by itself.</li>
        <li>You can pause; the clock stops, and the time you worked is recorded.</li>
        <li>You won't see whether an answer is right until the end. Then you get every solution with an explanation.</li>
        <li>Writing and speaking are scored at the end: by your AI tutor if you have a key, otherwise by you with a checklist.</li>
      </ul>
      <p className="rounded-xl bg-gold-soft px-3 py-2 text-sm">
        This is practice, not an official certificate. It shows whether you are ready for the real exam.
      </p>
      <button type="button" className="btn-primary" onClick={onStart}>
        Start the exam
      </button>
    </section>
  );
}

function SectionView(props: {
  exam: MockExam;
  index: number;
  unit: ReturnType<typeof examUnit>;
  answers: Record<string, Answer>;
  texts: Record<string, string>;
  takes: Record<string, Take>;
  onAnswer: (id: string, a: Answer | undefined) => void;
  onText: (id: string, t: string) => void;
  onTake: (id: string, t: Take) => void;
  onPaused: (sec: number) => void;
  onEnd: (entry: SectionLog) => void;
}) {
  const { exam, index, unit, answers, texts, takes } = props;
  const section = exam.sections[index]!;
  const total = section.minutes * 60;
  const [paused, setPaused] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [said, setSaid] = useState<string>();
  const pausedAt = useRef<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const ended = useRef(false);
  const endRef = useRef(props.onEnd);
  endRef.current = props.onEnd;

  const end = (timedOut: boolean) => {
    if (ended.current) return;
    ended.current = true;
    endRef.current({ usedSec: timer.usedSec(), timedOut });
  };
  const timer = useCountdown(total, paused, () => end(true));
  const pts = sectionPoints(section);
  const last = index === exam.sections.length - 1;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Polite announcements at 5 and 1 minute(s) left, never every second.
  useEffect(() => {
    const msg = announcement(timer.left, total);
    if (msg) setSaid(msg);
  }, [timer.left, total]);

  const togglePause = () => {
    if (paused) {
      if (pausedAt.current !== null) props.onPaused((Date.now() - pausedAt.current) / 1000);
      pausedAt.current = null;
      setPaused(false);
      setSaid('Resumed. The clock is running.');
    } else {
      pausedAt.current = Date.now();
      setPaused(true);
      setSaid('Paused. The clock has stopped.');
    }
  };

  const unanswered = section.exercises.filter((ex) => {
    if (ex.type === 'write' || ex.type === 'roleplay') return !(texts[ex.id] ?? '').trim();
    if (ex.type === 'speak') return !takes[ex.id];
    return answers[ex.id] === undefined;
  }).length;

  const next = () => {
    if (unanswered > 0 && !confirm) return setConfirm(true);
    end(false);
  };

  // Warn in the last minute (or the last quarter of very short sections).
  const low = timer.left <= Math.min(60, total / 4);
  return (
    <section className="space-y-4" aria-labelledby={`section-${section.id}`}>
      <div className="sticky top-12 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg/95 px-4 py-2 md:top-0">
        <h2 id={`section-${section.id}`} ref={heading} tabIndex={-1} className="text-lg font-semibold">
          <span className="sr-only">
            Section {index + 1} of {exam.sections.length}:{' '}
          </span>
          <span lang="de">{section.title}</span>
        </h2>
        <div className="flex items-center gap-2">
          <p
            role="timer"
            aria-label={`Time left in this section: ${spokenTime(timer.left)}`}
            className={`rounded-lg px-2 py-1 font-mono text-lg font-semibold tabular-nums ${low ? 'bg-bad-soft text-bad' : 'bg-surface-2'}`}
          >
            {clock(timer.left)}
          </p>
          <button type="button" className="btn-secondary" onClick={togglePause}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {low && !paused && (
        <p className="text-sm font-semibold text-bad">{timer.left <= 60 ? 'Less than a minute left.' : 'Time is nearly up.'} When the time is up, the exam moves on by itself.</p>
      )}

      {paused ? (
        <div className="card space-y-2 text-center">
          <p className="font-semibold">Paused</p>
          <p className="text-sm text-muted">The clock has stopped at {clock(timer.left)}. Your answers are kept.</p>
          <button type="button" className="btn-primary" onClick={togglePause}>
            Resume
          </button>
        </div>
      ) : null}

      <div hidden={paused} className="space-y-4">
        <div className="card space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Section {index + 1} of {exam.sections.length} · {SKILL_NAME[section.skill].en} · {section.minutes} min · {sectionMax(section)} point{sectionMax(section) === 1 ? '' : 's'}
          </p>
          <Instructions section={section} />
        </div>
        <Stimulus section={section} unit={unit} />
        <PageWideKeys.Provider value={false}>
        <ol className="space-y-4" aria-label="Items">
          {section.exercises.map((ex, i) => (
            <li key={ex.id}>
              <ExamItem
                ex={ex}
                unit={unit}
                n={i + 1}
                points={pts[i] ?? 1}
                text={texts[ex.id]}
                onAnswer={props.onAnswer}
                onText={props.onText}
                onTake={props.onTake}
              />
            </li>
          ))}
        </ol>
        </PageWideKeys.Provider>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={next}>
            {confirm ? 'Yes, go on' : last ? 'Finish the exam' : 'Next section'}
          </button>
          {confirm && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setConfirm(false)}>
                Keep working
              </button>
              <p role="status" className="w-full text-sm">
                {unanswered} item{unanswered === 1 ? ' is' : 's are'} not answered yet and will get 0 points. You can't come back to this section.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
