import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { CompiledUnit, Exercise, GrammarPoint, LevelPack } from '@doppelpunkt/content-schema';
import { unitProgress } from '@doppelpunkt/engine';
import { GermanText } from '../../components/GermanText';
import { Markdown } from '../../components/Markdown';
import { ProgressBar } from '../../components/ProgressBar';
import { SwissForms, VocabWord } from '../../components/VocabWord';
import { AudioButton } from '../../components/AudioButton';
import { ShadowPanel } from '../../components/ShadowPanel';
import { audioUrl } from '../../content';
import { db, type Dialect } from '../../db';
import { useAttempts, useUnitStatus } from '../../lib/hooks';
import { addUnitVocab, setCanDo, setUnitComplete } from '../../lib/progress';
import { ExerciseRunner } from './ExerciseRunner';

type DialogueLine = CompiledUnit['intro']['dialogue'][number];

function Dialogue({ unit, lines }: { unit: CompiledUnit; lines: DialogueLine[] }) {
  const [showEn, setShowEn] = useState(false);
  const [shadow, setShadow] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showEn} onChange={(e) => setShowEn(e.target.checked)} className="h-4 w-4" />
          Show English
        </label>
        {lines.length > 0 && (
          <button type="button" className="btn-ghost px-2 text-sm" aria-expanded={shadow} onClick={() => setShadow(!shadow)}>
            {shadow ? 'Hide shadowing' : 'Shadow the dialogue'}
          </button>
        )}
      </div>
      {shadow && (
        <ShadowPanel
          lines={lines.map((l) => ({ speaker: l.speaker, text: l.text, en: l.en, variety: l.variety, url: l.audio ? audioUrl(unit, l.audio) : undefined }))}
          onClose={() => setShadow(false)}
        />
      )}
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
        <GrammarPointCard key={g.id} point={g} />
      ))}
      <p className="text-sm">
        <Link to="/grammar" className="text-accent hover:underline">
          Grammar reference: every grammar point →
        </Link>
      </p>
    </div>
  );
}

/** One grammar point: title, Markdown body, tables and common mistakes. Shared with the grammar reference. */
export function GrammarPointCard({ point: g, headingLevel = 2, children }: { point: GrammarPoint; headingLevel?: 1 | 2; children?: ReactNode }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="card space-y-3" aria-labelledby={`g-${g.id}`}>
      <Heading id={`g-${g.id}`} className={headingLevel === 1 ? 'text-2xl font-bold' : 'text-lg font-semibold'}>
        {g.title}
      </Heading>
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
      {children}
    </section>
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

const DIALECT_NAME: Record<Dialect, string> = { 'gsw-zh': 'Zurich German', 'gsw-be': 'Bernese German' };
const otherDialect = (d: Dialect): Dialect => (d === 'gsw-zh' ? 'gsw-be' : 'gsw-zh');

/**
 * The learner's dialect for this unit's Swiss lane. Dialogue lines and exercises in the home dialect
 * come first; when the unit has none, the lane falls back to the other dialect (Zurich for Bern).
 */
export function swissLane(unit: CompiledUnit, dialect: Dialect) {
  const other = otherDialect(dialect);
  const lines = unit.swiss.dialogue;
  const hasHomeLines = lines.some((l) => l.variety === dialect);
  const hasOtherLines = lines.some((l) => l.variety === other);
  // Lines in neither dialect (narration, Swiss Standard German) always stay.
  const dialogueDialect: Dialect = hasHomeLines || !hasOtherLines ? dialect : other;
  const dialogue = lines.filter((l) => l.variety !== otherDialect(dialogueDialect));
  const otherDialogue = hasHomeLines && hasOtherLines ? lines.filter((l) => l.variety !== dialect) : [];
  const swiss = unit.exercises.filter(isSwiss);
  const home = swiss.filter((e) => e.variety === dialect);
  const exercises = [...home, ...swiss.filter((e) => e.variety !== dialect)];
  return {
    dialogue,
    otherDialogue,
    exercises,
    dialogueFallback: dialogueDialect !== dialect,
    exerciseFallback: swiss.length > 0 && home.length === 0,
  };
}

export function SchwiizStep({ unit, dialect }: { unit: CompiledUnit; dialect: Dialect }) {
  const lane = swissLane(unit, dialect);
  const [showOther, setShowOther] = useState(false);
  const other = otherDialect(dialect);
  const fallbackNote =
    lane.dialogueFallback && lane.exerciseFallback
      ? `This unit isn't written in ${DIALECT_NAME[dialect]} yet, so the Swiss lane uses ${DIALECT_NAME[other]}.`
      : lane.dialogueFallback
        ? `The dialogue isn't written in ${DIALECT_NAME[dialect]} yet; here it is in ${DIALECT_NAME[other]}.`
        : lane.exerciseFallback
          ? `No ${DIALECT_NAME[dialect]} exercises in this unit yet; these are in ${DIALECT_NAME[other]}.`
          : undefined;
  return (
    <div className="space-y-5">
      <p className="text-muted">{unit.swiss.scene}</p>
      {fallbackNote && (
        <p role="note" className="rounded-xl border border-swiss/30 bg-swiss-soft px-3 py-2 text-sm text-swiss-strong">
          {fallbackNote} The differences are small, and you'll understand both.
        </p>
      )}
      <Dialogue unit={unit} lines={lane.dialogue} />
      {lane.otherDialogue.length > 0 && (
        <div>
          <button type="button" className="btn-ghost px-0 text-sm" aria-expanded={showOther} onClick={() => setShowOther(!showOther)}>
            {showOther ? `Hide the ${DIALECT_NAME[other]} version` : `Show the ${DIALECT_NAME[other]} version`}
          </button>
          {showOther && <Dialogue unit={unit} lines={lane.otherDialogue} />}
        </div>
      )}
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
      {lane.exercises.length > 0 && <ExerciseRunner unit={unit} exercises={lane.exercises} label="Swiss exercises" />}
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
