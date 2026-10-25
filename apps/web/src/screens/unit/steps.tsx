import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CompiledUnit, Exercise, LevelPack } from '@doppelpunkt/content-schema';
import { unitProgress } from '@doppelpunkt/engine';
import { GermanText } from '../../components/GermanText';
import { Markdown } from '../../components/Markdown';
import { ProgressBar } from '../../components/ProgressBar';
import { SwissForms, VocabWord } from '../../components/VocabWord';
import { AudioButton } from '../../components/AudioButton';
import { audioUrl } from '../../content';
import { db, type Dialect } from '../../db';
import { useAttempts, useUnitStatus } from '../../lib/hooks';
import { addUnitVocab, setCanDo, setUnitComplete } from '../../lib/progress';
import { ExerciseRunner } from './ExerciseRunner';

type DialogueLine = CompiledUnit['intro']['dialogue'][number];

function Dialogue({ unit, lines }: { unit: CompiledUnit; lines: DialogueLine[] }) {
  const [showEn, setShowEn] = useState(false);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.target.checked)} className="h-4 w-4" />
        Show English
      </label>
      <ol className="space-y-3">
        {lines.map((l, i) => (
          <li key={i} className="card py-3">
            <p className="text-xs font-semibold text-muted">{l.speaker}</p>
            <GermanText text={l.text} variety={l.variety} audio={l.audio ? audioUrl(unit, l.audio) : true} className="text-base" />
            {showEn && <p className="mt-1 pl-9 text-sm text-muted">{l.en}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EinstiegStep({ unit }: { unit: CompiledUnit }) {
  return (
    <div className="space-y-4">
      <p className="text-muted">{unit.intro.scene}</p>
      <Dialogue unit={unit} lines={unit.intro.dialogue} />
      <div className="card">
        <p className="text-sm font-semibold">Goal</p>
        <p className="text-sm">{unit.goal}</p>
      </div>
    </div>
  );
}

export function WortschatzStep({ unit }: { unit: CompiledUnit }) {
  const inDeck = useLiveQuery(() => db.cards.where('unitId').equals(unit.id).count(), [unit.id]);
  const [added, setAdded] = useState<number>();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {unit.vocab.length} words · {inDeck ?? 0} in your review deck
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={inDeck === unit.vocab.length}
          onClick={async () => setAdded(await addUnitVocab(unit))}
        >
          {inDeck === unit.vocab.length ? 'All in review' : 'Add to review'}
        </button>
      </div>
      {added !== undefined && (
        <p role="status" className="text-sm text-ok">
          Added {added} cards.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {unit.vocab.map((v) => (
          <li key={v.id} className="card space-y-1.5 py-3">
            <div className="flex items-start justify-between gap-2">
              <VocabWord item={v} className="text-lg" />
              <AudioButton text={v.de} url={v.audio ? audioUrl(unit, v.audio) : undefined} />
            </div>
            {v.plural && <p className="text-sm text-muted">Plural: <span lang="de">{v.plural}</span></p>}
            <p className="text-sm">{v.en}</p>
            <SwissForms item={v} />
            {v.example && (
              <div className="border-l-2 border-line pl-2 text-sm">
                <GermanText text={v.example.de} variety="de" />
                <p className="text-muted">{v.example.en}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GrammatikStep({ unit }: { unit: CompiledUnit }) {
  return (
    <div className="space-y-4">
      {unit.grammar.map((g) => (
        <section key={g.id} className="card space-y-3" aria-labelledby={`g-${g.id}`}>
          <h2 id={`g-${g.id}`} className="text-lg font-semibold">
            {g.title}
          </h2>
          <Markdown text={g.body} className="text-sm leading-relaxed" />
          {g.tables.map((t, ti) => (
            <div key={ti} className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {(t[0] ?? []).map((h, i) => (
                      <th key={i} scope="col" className="border-b border-line px-2 py-1 text-left font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody lang="de">
                  {t.slice(1).map((row, ri) => (
                    <tr key={ri} className="odd:bg-surface-2">
                      {row.map((c, ci) => (
                        <td key={ci} className="px-2 py-1">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {g.commonMistakes.length > 0 && (
            <div className="rounded-xl bg-bad-soft p-3">
              <p className="text-sm font-semibold text-bad">Common mistakes</p>
              <ul className="list-disc pl-5 text-sm">
                {g.commonMistakes.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function LesenStep({ unit }: { unit: CompiledUnit }) {
  const [showEn, setShowEn] = useState(false);
  if (!unit.reading) return <p className="text-muted">This unit has no reading text.</p>;
  return (
    <article className="card space-y-3">
      <h2 lang="de" className="text-lg font-semibold">
        {unit.reading.title}
      </h2>
      <GermanText as="div" text={unit.reading.text} variety="de" audio className="whitespace-pre-wrap leading-relaxed" />
      <button type="button" className="btn-ghost px-0" aria-expanded={showEn} onClick={() => setShowEn(!showEn)}>
        {showEn ? 'Hide translation' : 'Show translation'}
      </button>
      {showEn && <p className="whitespace-pre-wrap text-sm text-muted">{unit.reading.en}</p>}
    </article>
  );
}

const isSwiss = (ex: Exercise) => ex.variety === 'gsw-zh' || ex.variety === 'gsw-be';

export function UebungenStep({ unit }: { unit: CompiledUnit }) {
  return <ExerciseRunner unit={unit} exercises={unit.exercises.filter((e) => !isSwiss(e))} label="Exercises" />;
}

export function SchwiizStep({ unit, dialect }: { unit: CompiledUnit; dialect: Dialect }) {
  const swiss = unit.exercises.filter(isSwiss);
  // Home dialect first; the other dialect stays available.
  const ordered = [...swiss.filter((e) => e.variety === dialect), ...swiss.filter((e) => e.variety !== dialect)];
  return (
    <div className="space-y-5">
      <p className="text-muted">{unit.swiss.scene}</p>
      <Dialogue unit={unit} lines={unit.swiss.dialogue} />
      <section className="card border-swiss/30" aria-labelledby="swiss-notes">
        <h2 id="swiss-notes" className="mb-2 font-semibold text-swiss-strong">
          Good to know in Switzerland
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {unit.swiss.notes.map((n, i) => (
            <li key={i}>
              <Markdown text={n} />
            </li>
          ))}
        </ul>
      </section>
      {ordered.length > 0 && <ExerciseRunner unit={unit} exercises={ordered} label="Swiss exercises" />}
    </div>
  );
}

export function CheckStep({ unit, pack }: { unit: CompiledUnit; pack?: LevelPack }) {
  const status = useUnitStatus(unit.id);
  const attempts = useAttempts(unit.id);
  const p = unitProgress(unit, attempts ?? []);
  const next = pack?.units.find((u) => u.number === unit.number + 1);
  return (
    <div className="space-y-4">
      <section className="card space-y-2" aria-labelledby="cando-title">
        <h2 id="cando-title" className="font-semibold">
          Can you do this now?
        </h2>
        {unit.canDo.map((c, i) => (
          <label key={i} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={status?.canDo[i] ?? false}
              onChange={(e) => void setCanDo(unit, i, e.target.checked)}
            />
            {c}
          </label>
        ))}
      </section>
      <section className="card space-y-2">
        <p className="text-sm">
          Exercises done: {p.done} / {p.total} · average score {Math.round(p.avgScore * 100)}%
        </p>
        <ProgressBar value={p.total ? p.done / p.total : 0} label="Exercises done" />
      </section>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => void setUnitComplete(unit, !status?.completedAt)}>
          {status?.completedAt ? 'Mark as not done' : 'Mark unit as done'}
        </button>
        {next && (
          <Link className="btn-secondary" to={`/unit/${next.id}`}>
            Next: {next.title}
          </Link>
        )}
      </div>
    </div>
  );
}
