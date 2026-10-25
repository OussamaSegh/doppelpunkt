// Mock exam results: total and per-section points against the pass mark, then a full review of
// every item with its solution and explanation, and links to the grammar behind lost points.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Exercise, LevelPack, MockExam } from '@doppelpunkt/content-schema';
import type { GradeResult } from '@doppelpunkt/engine';
import type { WritingFeedback } from '@doppelpunkt/ai';
import { DiffView } from '../../components/DiffView';
import { ReportProblem } from '../../components/ReportProblem';
import { GermanText } from '../../components/GermanText';
import { VarietyTag } from '../../components/VarietyTag';
import type { ExamItemResult, ExamResultRow } from '../../db';
import { WritingReport } from '../../exercise/WriteTask';
import { TYPE_LABEL } from '../../exercise/ExercisePlayer';
import { listeningTranscript, TranscriptText } from '../../exercise/Listen';
import { clock, practiseLinks, SKILL_NAME, verdictText } from '../../lib/exam';
import { asWriting } from './ExamMarking';

/** The model solution of any exercise, as text. */
export function solutionOf(ex: Exercise): string {
  switch (ex.type) {
    case 'mcq':
      return ex.options[ex.answer] ?? '';
    case 'gap': {
      const parts = ex.text.split('___');
      return parts.map((p, i) => p + (i < parts.length - 1 ? (ex.answers[i]?.[0] ?? '') : '')).join('');
    }
    case 'order':
    case 'translate':
    case 'transform':
      return ex.answers[0] ?? '';
    case 'match':
      return ex.pairs.map(([a, b]) => `${a} = ${b}`).join('; ');
    case 'dictation':
      return ex.transcript;
    case 'speak':
      return ex.target;
    case 'write':
    case 'roleplay':
      return ex.model;
  }
}

const solutionVariety = (ex: Exercise) => (ex.type === 'transform' ? ex.to : ex.variety);

const METHOD: Record<ExamItemResult['method'], string> = {
  auto: '',
  ai: 'Scored by your AI tutor.',
  self: 'Scored by you.',
  unanswered: 'Not answered.',
};

const fmtPoints = (n: number) => String(Math.round(n * 10) / 10);

export function ExamResults({ exam, row, pack, onRetake }: { exam: MockExam; row: ExamResultRow; pack?: LevelPack; onRetake?: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const verdict = verdictText({ points: row.points, max: row.max, passMark: row.passMark, passed: row.passed });
  const links = practiseLinks(exam, pack, row.items);
  const items = new Map(row.items.map((i) => [i.exerciseId, i] as const));

  return (
    <div className="space-y-5">
      <section className="card space-y-3" aria-labelledby="exam-result-title">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Mock exam result · {exam.title}</p>
        <h1 id="exam-result-title" ref={heading} tabIndex={-1} className="text-2xl font-bold">
          {row.passed ? 'Bestanden — passed' : 'Nicht bestanden — not passed yet'}
        </h1>
        <div aria-live="polite" className="space-y-1">
          <p className={`text-lg font-semibold ${row.passed ? 'text-ok' : 'text-bad'}`}>{verdict.headline}</p>
          <p>{verdict.detail}</p>
        </div>
        <p className="text-sm text-muted">
          Taken {new Date(row.at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })} · {clock(row.durationSec)} working time
          {row.pausedSec >= 1 ? ` (paused ${clock(row.pausedSec)})` : ''}. This is practice, not an official certificate.
        </p>

        <table className="w-full text-sm">
          <caption className="sr-only">Points per section</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-2 font-medium">Section</th>
              <th scope="col" className="py-1 pr-2 font-medium">Points</th>
              <th scope="col" className="py-1 pr-2 font-medium">Score</th>
              <th scope="col" className="py-1 pr-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {exam.sections.map((s) => {
              const r = row.sections.find((x) => x.sectionId === s.id);
              const pct = r && r.max ? Math.round((r.points / r.max) * 100) : 0;
              return (
                <tr key={s.id} className="border-t border-line">
                  <th scope="row" className="py-1 pr-2 text-left font-semibold">
                    <span lang="de">{SKILL_NAME[s.skill].de}</span> <span className="font-normal text-muted">({SKILL_NAME[s.skill].en})</span>
                  </th>
                  <td className="py-1 pr-2 tabular-nums">
                    {fmtPoints(r?.points ?? 0)} / {fmtPoints(r?.max ?? 0)}
                  </td>
                  <td className={`py-1 tabular-nums ${pct >= row.passMark * 100 ? 'text-ok' : 'text-bad'}`}>{pct}%</td>
                  <td className="py-1 pr-2 tabular-nums">
                    {clock(r?.usedSec ?? 0)} / {s.minutes}:00{r?.timedOut ? ' (time ran out)' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <th scope="row" className="py-1 pr-2 text-left">Total</th>
              <td className="py-1 pr-2 tabular-nums">
                {fmtPoints(row.points)} / {fmtPoints(row.max)}
              </td>
              <td className="py-1 pr-2 tabular-nums">{row.max ? Math.round((row.points / row.max) * 100) : 0}%</td>
              <td className="py-1 pr-2 text-xs font-normal text-muted">pass mark {Math.round(row.passMark * 100)}%</td>
            </tr>
          </tfoot>
        </table>
        <div className="flex flex-wrap gap-2">
          {onRetake && (
            <button type="button" className="btn-secondary" onClick={onRetake}>
              Take the exam again
            </button>
          )}
          <Link to="/progress" className="btn-ghost">
            See Progress
          </Link>
        </div>
      </section>

      <section className="card space-y-2" aria-labelledby="practise-title">
        <h2 id="practise-title" className="font-semibold">
          Practise these grammar points
        </h2>
        {links.length === 0 ? (
          <p className="text-sm text-muted">No grammar points behind lost points. Well done.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {links.map((l) => (
              <li key={l.grammarId} className="flex justify-between gap-2">
                <Link to={`/grammar/${l.unitId}/${l.grammarId}`} className="text-accent underline-offset-2 hover:underline">
                  {l.title}
                </Link>
                <span className="tabular-nums text-muted">{fmtPoints(l.lost)} point{l.lost === 1 ? '' : 's'} lost</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-title" className="space-y-4">
        <h2 id="review-title" className="text-xl font-bold">
          Review: every answer with its solution
        </h2>
        {exam.sections.map((s) => (
          <section key={s.id} aria-labelledby={`review-${s.id}`} className="space-y-3">
            <h3 id={`review-${s.id}`} className="text-lg font-semibold">
              <span lang="de">{s.title}</span>
            </h3>
            {s.stimulus && (
              <details className="card">
                <summary className="cursor-pointer text-sm font-semibold">{s.skill === 'listening' ? 'Transcript' : 'Text'}{s.stimulus.title ? `: ${s.stimulus.title}` : ''}</summary>
                <GermanText as="div" text={s.stimulus.text} variety={s.stimulus.variety} className="mt-2 whitespace-pre-wrap" />
              </details>
            )}
            <ol className="space-y-3">
              {s.exercises.map((ex, i) => (
                <li key={ex.id}>
                  <ReviewItem ex={ex} n={i + 1} item={items.get(ex.id)} examId={exam.id} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </section>
    </div>
  );
}

function ReviewItem({ ex, n, item, examId }: { ex: Exercise; n: number; item?: ExamItemResult; examId: string }) {
  const result = item?.result as GradeResult | undefined;
  const feedback = item?.feedback as WritingFeedback | undefined;
  const full = !!item && item.points >= item.max;
  const none = !item || item.points <= 0;
  const tone = full ? 'border-ok/40' : none ? 'border-bad/40' : 'border-accent/40';
  const checklist = ex.type === 'write' || ex.type === 'roleplay' ? asWriting(ex).checklist : [];
  const transcript = listeningTranscript(ex);
  return (
    <article className={`card space-y-2 border-l-4 ${tone}`} aria-labelledby={`rev-${ex.id}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={`rev-${ex.id}`} className="font-semibold">
          {n}. {ex.prompt}
        </h4>
        <span className={`text-sm font-semibold tabular-nums ${full ? 'text-ok' : none ? 'text-bad' : 'text-accent'}`}>
          {fmtPoints(item?.points ?? 0)} / {fmtPoints(item?.max ?? 1)} points
        </span>
      </header>
      <p className="text-xs text-muted">
        {TYPE_LABEL[ex.type]} <VarietyTag variety={ex.variety} /> {METHOD[item?.method ?? 'unanswered']}
      </p>
      {transcript && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Transcript</p>
          <TranscriptText text={transcript} variety={ex.variety} className="text-sm" />
        </div>
      )}
      {ex.type === 'mcq' && ex.question && <GermanText text={ex.question} variety={ex.variety} />}
      {item?.answer ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your answer</p>
          <p lang="de" className="whitespace-pre-wrap">{item.answer}</p>
        </div>
      ) : null}
      {result?.diff && result.diff.length > 0 && !result.correct && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Word by word</p>
          <DiffView tokens={result.diff} />
        </div>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{ex.type === 'write' || ex.type === 'roleplay' ? 'Model answer' : 'Solution'}</p>
        <GermanText text={solutionOf(ex)} variety={solutionVariety(ex)} className="whitespace-pre-wrap font-medium" />
      </div>
      {result && result.feedback.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {result.feedback.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {feedback && <WritingReport fb={feedback} />}
      {item?.selfCheck && checklist.length > 0 && (
        <ul className="space-y-0.5 text-sm" aria-label="Your checklist">
          {checklist.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className={item.selfCheck?.[i] ? 'text-ok' : 'text-muted'}>
                {item.selfCheck?.[i] ? '✓' : '○'}
              </span>
              <span>{c}</span>
              <span className="sr-only">{item.selfCheck?.[i] ? '(ticked)' : '(not ticked)'}</span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Explanation</p>
        <p className="text-sm">{ex.explanation}</p>
        {ex.type === 'mcq' && ex.rationales && (
          <ul className="mt-1 space-y-0.5 text-sm">
            {ex.options.map((o, i) =>
              ex.rationales?.[i] ? (
                <li key={i}>
                  <span lang="de" className="font-medium">{o}:</span> {ex.rationales[i]}
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
      <ReportProblem target={{ itemId: ex.id, unitId: `exam-${examId}`, answer: item?.answer }} />
    </article>
  );
}
