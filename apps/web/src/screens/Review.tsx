import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Level, VocabItem } from '@doppelpunkt/content-schema';
import { dueCards, review, type Rating } from '@doppelpunkt/engine';
import { AudioButton } from '../components/AudioButton';
import { ContentGate } from '../components/ContentGate';
import { EmptyState } from '../components/EmptyState';
import { GermanText } from '../components/GermanText';
import { SwissForms, VocabWord } from '../components/VocabWord';
import { allUnits, audioUrl, useContent } from '../content';
import { db, type CardRow } from '../db';

const RATINGS: Array<{ id: Rating; label: string; className: string }> = [
  { id: 'again', label: 'Again', className: 'border-bad/50 text-bad' },
  { id: 'hard', label: 'Hard', className: 'border-gold/50 text-gold-strong' },
  { id: 'good', label: 'Good', className: 'border-ok/50 text-ok' },
  { id: 'easy', label: 'Easy', className: 'border-accent/50 text-accent' },
];

type Direction = 'de-en' | 'en-de';

export function Review() {
  return (
    <ContentGate>
      <ReviewSession />
    </ContentGate>
  );
}

function ReviewSession() {
  const packs = useContent((s) => s.packs);
  const cards = useLiveQuery(() => db.cards.toArray(), []);
  const [direction, setDirection] = useState<Direction>('de-en');
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const vocab = useMemo(() => {
    const map = new Map<string, { item: VocabItem; unitId: string; level: Level }>();
    for (const u of allUnits(packs)) for (const v of u.vocab) map.set(v.id, { item: v, unitId: u.id, level: u.level });
    return map;
  }, [packs]);

  if (!cards) return <p role="status">Loading cards…</p>;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const due = dueCards(cards)
    .map((c) => byId.get(c.id))
    .filter((c): c is CardRow => !!c && vocab.has(c.id));
  const card = due[0];

  if (!cards.length) {
    return (
      <EmptyState title="Your review deck is empty" action={<Link className="btn-primary" to="/learn">Open a unit</Link>}>
        Open a unit's <span lang="de">Wortschatz</span> step and tap "Add to review".
      </EmptyState>
    );
  }
  if (!card) {
    return (
      <EmptyState title="All caught up" action={<Link className="btn-secondary" to="/learn">Keep learning</Link>}>
        {reviewed ? `You reviewed ${reviewed} cards. ` : ''}No cards are due right now.
      </EmptyState>
    );
  }

  const entry = vocab.get(card.id);
  if (!entry) return null;
  const { item } = entry;
  const url = item.audio ? audioUrl({ id: entry.unitId, level: entry.level }, item.audio) : undefined;

  const rate = async (r: Rating) => {
    const next = review(card, r);
    await db.cards.put({ ...next, unitId: card.unitId, addedAt: card.addedAt });
    setRevealed(false);
    setReviewed((n) => n + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Review</h1>
        <p className="text-sm text-muted">{due.length} due</p>
      </div>
      <div role="radiogroup" aria-label="Card direction" className="flex gap-2">
        {(['de-en', 'en-de'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => setDirection(d)}
            className={`chip ${direction === d ? 'border-accent bg-accent-soft text-accent' : ''}`}
          >
            {d === 'de-en' ? 'German → English' : 'English → German'}
          </button>
        ))}
      </div>

      <section className="card min-h-64 space-y-4 text-center" aria-live="polite" aria-label="Flashcard">
        {direction === 'de-en' || revealed ? (
          <div className="flex items-center justify-center gap-2">
            <VocabWord item={item} className="text-2xl" />
            <AudioButton text={item.de} url={url} />
          </div>
        ) : (
          <p className="text-2xl font-semibold">{item.en}</p>
        )}

        {revealed ? (
          <div className="space-y-3 border-t border-line pt-4 text-left">
            {direction === 'de-en' && <p className="text-center text-xl">{item.en}</p>}
            {item.plural && (
              <p className="text-sm">
                <span className="text-muted">Plural:</span> <span lang="de">{item.plural}</span>
              </p>
            )}
            <SwissForms item={item} />
            {item.example && (
              <div className="text-sm">
                <GermanText text={item.example.de} variety="de" audio />
                <p className="pl-9 text-muted">{item.example.en}</p>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setRevealed(true)}>
            Show answer
          </button>
        )}
      </section>

      {revealed && (
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you know it?">
          {RATINGS.map((r) => (
            <button key={r.id} type="button" className={`btn-secondary ${r.className}`} onClick={() => void rate(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
