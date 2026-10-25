import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PronunciationDrill, Variety } from '@doppelpunkt/content-schema';
import { AudioButton } from '../components/AudioButton';
import { EmptyState } from '../components/EmptyState';
import { GermanText } from '../components/GermanText';
import { Markdown } from '../components/Markdown';
import { SpeakCheck } from '../components/SpeakCheck';
import { VarietyTag } from '../components/VarietyTag';
import { useAttempts } from '../lib/hooks';
import {
  discriminationQuiz,
  drillAudioUrl,
  drillSpeakExercise,
  drillUnitId,
  recordDrillAttempt,
  usePronunciation,
  type DrillItem,
} from '../lib/pronunciation';
import { nativeSource, playNative } from '../lib/speech';

export function Pronunciation() {
  const { status, drills, error, load } = usePronunciation();
  const { drillId } = useParams();
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);

  if (status === 'idle' || status === 'loading') {
    return (
      <p role="status" className="p-6 text-center text-muted">
        Loading pronunciation drills…
      </p>
    );
  }
  if (status === 'error') {
    return (
      <EmptyState headingLevel={1}
        title="Pronunciation drills could not be loaded"
        action={
          <button className="btn-primary" onClick={() => void load()}>
            Try again
          </button>
        }
      >
        <p>{error}</p>
        <p className="mt-1">If you are offline, open this page once online so the drills are saved for offline use.</p>
      </EmptyState>
    );
  }
  if (drillId) {
    const drill = drills.find((d) => d.id === drillId);
    if (!drill) {
      return (
        <EmptyState headingLevel={1}
          title="Drill not found"
          action={
            <Link className="btn-primary" to="/pronunciation">
              All drills
            </Link>
          }
        >
          This pronunciation drill isn't installed.
        </EmptyState>
      );
    }
    return <DrillView key={drill.id} drill={drill} />;
  }
  return <DrillList drills={drills} empty={status === 'empty'} onReload={() => void load()} />;
}

function DrillList({ drills, empty, onReload }: { drills: PronunciationDrill[]; empty: boolean; onReload: () => void }) {
  const attempts = useAttempts();
  const best = useMemo(() => {
    const m = new Map<string, { n: number; sum: number }>();
    for (const a of attempts ?? []) {
      if (!a.unitId.startsWith('pron-') || a.skill !== 'speaking') continue;
      const cur = m.get(a.unitId) ?? { n: 0, sum: 0 };
      m.set(a.unitId, { n: cur.n + 1, sum: cur.sum + a.score });
    }
    return m;
  }, [attempts]);

  return (
    <div className="space-y-5">
      <header>
        <Link to="/learn" className="text-sm text-accent hover:underline">
          ← Learn
        </Link>
        <h1 className="mt-1 text-xl font-bold">Pronunciation</h1>
        <p className="text-sm text-muted">One sound per drill: hear the difference, then say it. Your speaking scores feed the skill radar.</p>
      </header>
      {empty ? (
        <EmptyState
          title="No pronunciation drills installed yet"
          action={
            <button className="btn-secondary" onClick={onReload}>
              Check again
            </button>
          }
        >
          <p>
            <code>/packs/pronunciation.json</code> is missing or has no drills.
          </p>
          <p className="mt-1">
            Developers: run <code>npm run content:build</code>.
          </p>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Pronunciation drills">
          {drills.map((d) => {
            const s = best.get(drillUnitId(d));
            return (
              <li key={d.id}>
                <Link to={`/pronunciation/${d.id}`} className="card block h-full space-y-1 transition-colors hover:border-accent">
                  <span className="flex items-center gap-2">
                    <VarietyTag variety={d.variety} />
                    <span className="font-semibold">{d.title}</span>
                  </span>
                  {d.ipa.length > 0 && <span className="block font-mono text-sm text-muted">{d.ipa.map((x) => `/${x}/`).join(' · ')}</span>}
                  <span className="block text-xs text-muted">
                    {d.level} · {d.pairs.length} pairs · {d.words.length} words
                    {s ? ` · ${s.n} ${s.n === 1 ? 'try' : 'tries'}, ${Math.round((s.sum / s.n) * 100)}% avg` : ''}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Listen button that never uses a wrong TTS voice for Swiss German. */
function Listen({ drill, item, label, rate }: { drill: PronunciationDrill; item: DrillItem; label?: string; rate?: number }) {
  const url = drillAudioUrl(drill, item.audio);
  if (nativeSource(drill.variety, url) === 'none') return <span className="text-xs text-muted">No recording yet</span>;
  return <AudioButton text={item.text} variety={drill.variety} url={url} rate={rate} label={label} />;
}

type RepeatItem = { kind: 'pair' | 'word' | 'sentence'; index: number; item: DrillItem };

function DrillView({ drill }: { drill: PronunciationDrill }) {
  const repeatItems = useMemo<RepeatItem[]>(
    () => [
      ...drill.pairs.flatMap((p, i) => [
        { kind: 'pair' as const, index: i * 2, item: p[0] },
        { kind: 'pair' as const, index: i * 2 + 1, item: p[1] },
      ]),
      ...drill.words.map((w, i) => ({ kind: 'word' as const, index: i, item: w })),
      ...drill.sentences.map((s, i) => ({ kind: 'sentence' as const, index: i, item: s })),
    ],
    [drill],
  );
  const [step, setStep] = useState(0);
  const jump = (kind: RepeatItem['kind'], index: number) => {
    const at = repeatItems.findIndex((r) => r.kind === kind && r.index === index);
    if (at >= 0) setStep(at);
    document.getElementById('repeat')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5">
      <header>
        <Link to="/pronunciation" className="text-sm text-accent hover:underline">
          ← All drills
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <VarietyTag variety={drill.variety} />
          {drill.title}
        </h1>
        <p className="text-sm text-muted">
          {drill.level}
          {drill.ipa.length > 0 && <span className="font-mono"> · {drill.ipa.map((x) => `/${x}/`).join(' vs ')}</span>}
        </p>
      </header>

      <section className="card space-y-3" aria-labelledby="how">
        <h2 id="how" className="text-lg font-semibold">
          How to say it
        </h2>
        <Markdown text={drill.explanation} className="text-sm leading-relaxed" />
        {drill.tips.length > 0 && (
          <div>
            <p className="text-sm font-semibold">Tips</p>
            <ul className="list-disc pl-5 text-sm">
              {drill.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {drill.pairs.length > 0 && (
        <section className="card space-y-3" aria-labelledby="pairs">
          <h2 id="pairs" className="text-lg font-semibold">
            Minimal pairs
          </h2>
          <p className="text-sm text-muted">Only one sound changes. Listen to each side.</p>
          <ul className="space-y-2" aria-label="Minimal pairs">
            {drill.pairs.map((p, i) => (
              <li key={i} className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-2">
                {p.map((side, s) => (
                  <div key={s} className="flex items-start gap-1">
                    <Listen drill={drill} item={side} />
                    <span>
                      <span lang="de" className="block font-medium">
                        {side.text}
                      </span>
                      <span className="block text-xs text-muted">{side.en}</span>
                    </span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {drill.pairs.length > 0 && <Quiz drill={drill} />}

      {repeatItems.length > 0 && (
        <section id="repeat" className="card space-y-3" aria-labelledby="repeat-title">
          <h2 id="repeat-title" className="text-lg font-semibold">
            Repeat after me
          </h2>
          <RepeatStepper drill={drill} items={repeatItems} step={step} setStep={setStep} />
        </section>
      )}

      <ItemList title="Words" drill={drill} items={drill.words} onPractise={(i) => jump('word', i)} />
      <ItemList title="Sentences" drill={drill} items={drill.sentences} onPractise={(i) => jump('sentence', i)} />

      {drill.commonMistakes.length > 0 && (
        <section className="rounded-xl bg-bad-soft p-3" aria-labelledby="mistakes">
          <h2 id="mistakes" className="text-sm font-semibold text-bad">
            Common mistakes
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {drill.commonMistakes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ItemList({
  title,
  drill,
  items,
  onPractise,
}: {
  title: string;
  drill: PronunciationDrill;
  items: DrillItem[];
  onPractise: (i: number) => void;
}) {
  if (!items.length) return null;
  const id = `list-${title.toLowerCase()}`;
  return (
    <section className="card space-y-2" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      <ul className="space-y-2">
        {items.map((w, i) => (
          <li key={i} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <GermanText text={w.text} variety={drill.variety} />
              <span className="block pl-9 text-xs text-muted">{w.en}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Listen drill={drill} item={w} />
              <button type="button" className="btn-ghost px-2 text-sm" onClick={() => onPractise(i)} aria-label={`Practise: ${w.text}`}>
                Practise
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RepeatStepper({
  drill,
  items,
  step,
  setStep,
}: {
  drill: PronunciationDrill;
  items: RepeatItem[];
  step: number;
  setStep: (n: number) => void;
}) {
  const cur = items[step];
  if (!cur) return null;
  const ex = drillSpeakExercise(drill, cur.kind, cur.index, cur.item);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← Previous
        </button>
        <span className="text-sm tabular-nums text-muted" aria-live="polite">
          {step + 1} of {items.length}
        </span>
        <button type="button" className="btn-secondary" disabled={step === items.length - 1} onClick={() => setStep(step + 1)}>
          Next →
        </button>
      </div>
      <div>
        <GermanText text={cur.item.text} variety={drill.variety} className="text-xl font-medium" />
        <p className="pl-9 text-sm text-muted">{cur.item.en}</p>
      </div>
      <SpeakCheck
        key={ex.id}
        ex={ex}
        nativeUrl={drillAudioUrl(drill, cur.item.audio)}
        shadowing
        retry
        ratings={[
          { label: 'Needs work', score: 0.3 },
          { label: 'Good', score: 1 },
        ]}
        onGraded={(o) => recordDrillAttempt(drill, ex.id, o.score)}
      />
    </div>
  );
}

function canPlay(drill: PronunciationDrill, items: DrillItem[]) {
  return items.every((it) => nativeSource(drill.variety as Variety, drillAudioUrl(drill, it.audio)) !== 'none');
}

/** "Which did you hear?" — one question per minimal pair. Answers count as listening attempts. */
function Quiz({ drill }: { drill: PronunciationDrill }) {
  const [round, setRound] = useState(0);
  const questions = useMemo(() => discriminationQuiz(drill, `${drill.id}:${round}`), [drill, round]);
  const [n, setN] = useState(0);
  const [picked, setPicked] = useState<number>();
  const [right, setRight] = useState(0);
  const q = questions[n];
  const playable = canPlay(drill, drill.pairs.flat());

  if (!playable) {
    return (
      <section className="card" aria-labelledby="quiz">
        <h2 id="quiz" className="text-lg font-semibold">
          Which did you hear?
        </h2>
        <p className="text-sm text-muted">No recording yet: this quiz needs native recordings of every pair.</p>
      </section>
    );
  }

  const play = () => q && void playNative({ url: drillAudioUrl(drill, q.play.audio), text: q.play.text, variety: drill.variety });
  const pick = async (i: number) => {
    if (!q || picked !== undefined) return;
    setPicked(i);
    const ok = i === q.answer;
    if (ok) setRight(right + 1);
    await recordDrillAttempt(drill, q.id, ok ? 1 : 0, 'listening');
  };
  const next = () => {
    setPicked(undefined);
    setN(n + 1);
  };

  return (
    <section className="card space-y-3" aria-labelledby="quiz">
      <h2 id="quiz" className="text-lg font-semibold">
        Which did you hear?
      </h2>
      {q ? (
        <>
          <p className="text-sm text-muted">
            Question {n + 1} of {questions.length}. Play the word, then pick what you heard.
          </p>
          <button type="button" className="btn-primary" onClick={play}>
            Play the word
          </button>
          <div role="group" aria-label="What did you hear?" className="grid grid-cols-2 gap-2">
            {q.options.map((o, i) => {
              const state = picked === undefined ? '' : i === q.answer ? 'border-ok bg-ok-soft' : i === picked ? 'border-bad bg-bad-soft' : '';
              return (
                <button
                  key={i}
                  type="button"
                  lang="de"
                  className={`btn-secondary justify-center ${state}`}
                  disabled={picked !== undefined}
                  onClick={() => void pick(i)}
                >
                  {o.text}
                </button>
              );
            })}
          </div>
          {picked !== undefined && (
            <div aria-live="polite" className="space-y-2">
              <p className={`font-semibold ${picked === q.answer ? 'text-ok' : 'text-bad'}`}>
                {picked === q.answer ? 'Richtig!' : `Not quite: it was “${q.play.text}” (${q.play.en}).`}
              </p>
              <button type="button" className="btn-secondary" onClick={next}>
                {n + 1 < questions.length ? 'Next question' : 'See result'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2" aria-live="polite">
          <p className="font-semibold">
            You heard {right} of {questions.length} right.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setRound(round + 1);
              setN(0);
              setRight(0);
              setPicked(undefined);
            }}
          >
            Try the quiz again
          </button>
        </div>
      )}
    </section>
  );
}
