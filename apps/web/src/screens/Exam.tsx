// /exam lists the mock exams of every installed level; /exam/:examId runs one, and
// /exam/:examId?result=<id> shows the review of a saved attempt.
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LevelPack, MockExam } from '@doppelpunkt/content-schema';
import { ContentGate } from '../components/ContentGate';
import { EmptyState } from '../components/EmptyState';
import { useContent } from '../content';
import { db, type ExamResultRow } from '../db';
import { examMinutes, FORMAT_NAME, SKILL_NAME } from '../lib/exam';
import { ExamResults } from './exam/ExamResults';
import { ExamRun } from './exam/ExamRun';
import { canOpenLevel, useEntitlements } from '../lib/billing/entitlements';
import { LockedNotice, LockIcon } from '../components/Lock';

export function Exam() {
  return (
    <ContentGate>
      <ExamRoute />
    </ContentGate>
  );
}

export function findExam(packs: LevelPack[], examId: string): { exam: MockExam; pack: LevelPack } | undefined {
  for (const pack of packs) {
    const exam = pack.exams.find((e) => e.id === examId);
    if (exam) return { exam, pack };
  }
  return undefined;
}

function ExamRoute() {
  const { examId } = useParams();
  const [search] = useSearchParams();
  const packs = useContent((s) => s.packs);
  const ent = useEntitlements();
  if (!examId) return <ExamList packs={packs} />;
  const found = findExam(packs, examId);
  if (!found) {
    return (
      <EmptyState headingLevel={1} title="Exam not found" action={<Link className="btn-primary" to="/exam">All mock exams</Link>}>
        "{examId}" isn't in the installed lessons.
      </EmptyState>
    );
  }
  if (!ent.ready) return <p role="status">Checking your unlocks…</p>;
  if (!canOpenLevel(found.pack.level, ent)) return <LockedNotice level={found.pack.level} what={`The ${found.pack.level} mock exam`} />;
  const resultId = Number(search.get('result'));
  if (Number.isInteger(resultId) && resultId > 0) return <SavedResult exam={found.exam} pack={found.pack} id={resultId} />;
  return (
    <div className="space-y-3">
      <Link to="/exam" className="text-sm text-accent hover:underline">
        ← All mock exams
      </Link>
      <ExamRun key={found.exam.id} exam={found.exam} pack={found.pack} />
    </div>
  );
}

function SavedResult({ exam, pack, id }: { exam: MockExam; pack: LevelPack; id: number }) {
  const row = useLiveQuery(() => db.examResults.get(id).then((r) => r ?? null), [id]);
  if (row === undefined) return <p role="status">Loading the result…</p>;
  if (!row || row.examId !== exam.id) {
    return (
      <EmptyState headingLevel={1} title="Result not found" action={<Link className="btn-primary" to={`/exam/${exam.id}`}>Take the exam</Link>}>
        This attempt isn't saved on this device.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <Link to="/exam" className="text-sm text-accent hover:underline">
        ← All mock exams
      </Link>
      <ExamResults exam={exam} row={row} pack={pack} />
      <Link to={`/exam/${exam.id}`} className="btn-secondary">
        Take the exam again
      </Link>
    </div>
  );
}

function ExamList({ packs }: { packs: LevelPack[] }) {
  const results = useLiveQuery(() => db.examResults.orderBy('at').reverse().toArray(), []);
  const withExams = packs.filter((p) => p.exams.length > 0);
  const ent = useEntitlements();
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Mock exams</h1>
        <p className="text-sm text-muted">
          Timed practice papers in the format of the Goethe, telc and ÖSD exams, with every solution explained. Practice only, not an official certificate.
        </p>
      </header>
      {withExams.length === 0 ? (
        <EmptyState title="No mock exam installed yet">The A1 mock exam is being written. It appears here once its level is complete.</EmptyState>
      ) : (
        withExams.map((p) => (
          <section key={p.level} aria-labelledby={`exams-${p.level}`} className="space-y-3">
            <h2 id={`exams-${p.level}`} className="flex items-center gap-1.5 font-semibold">
              {p.level}
              {ent.ready && !canOpenLevel(p.level, ent) && (
                <Link to={`/unlock/${p.level}`} className="inline-flex items-center gap-1 text-sm font-normal text-muted underline">
                  <LockIcon /> Locked: unlock {p.level}
                </Link>
              )}
            </h2>
            <ul className="space-y-3">
              {p.exams.map((e) => (
                <li key={e.id}>
                  <ExamCard exam={e} latest={results?.find((r) => r.examId === e.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ExamCard({ exam, latest }: { exam: MockExam; latest?: ExamResultRow }) {
  return (
    <article className="card space-y-2" aria-labelledby={`exam-${exam.id}`}>
      <h3 id={`exam-${exam.id}`} className="text-lg font-semibold">
        {exam.title}
      </h3>
      <p className="text-sm text-muted">
        {exam.format === 'generic' ? '' : `${FORMAT_NAME[exam.format]} format · `}
        {examMinutes(exam)} min · pass mark {Math.round(exam.passMark * 100)}%
      </p>
      <p className="text-sm">
        {exam.sections.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ' · '}
            <span lang="de">{SKILL_NAME[s.skill].de}</span> {s.minutes} min
          </span>
        ))}
      </p>
      {latest && (
        <p className="text-sm">
          Last attempt: {latest.points} / {latest.max} points, <span className={latest.passed ? 'text-ok' : 'text-bad'}>{latest.passed ? 'passed' : 'not passed'}</span>{' '}
          (<Link className="text-accent underline" to={`/exam/${exam.id}?result=${latest.id}`}>review</Link>)
        </p>
      )}
      <Link to={`/exam/${exam.id}`} className="btn-primary">
        {latest ? 'Take it again' : 'Start'}
      </Link>
    </article>
  );
}
