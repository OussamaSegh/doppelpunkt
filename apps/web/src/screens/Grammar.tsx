import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LEVELS } from '@doppelpunkt/content-schema';
import { ContentGate } from '../components/ContentGate';
import { EmptyState } from '../components/EmptyState';
import { VarietyTag } from '../components/VarietyTag';
import { useContent } from '../content';
import { excerpt, exercisesFor, grammarIndex, searchGrammar, type GrammarEntry } from '../lib/grammar';
import { GrammarPointCard } from './unit/steps';

export function Grammar() {
  return (
    <ContentGate>
      <GrammarScreen />
    </ContentGate>
  );
}

function GrammarScreen() {
  const { unitId, grammarId } = useParams();
  const packs = useContent((s) => s.packs);
  const entries = useMemo(() => grammarIndex(packs), [packs]);
  if (unitId && grammarId) {
    const entry = entries.find((e) => e.unit.id === unitId && e.point.id === grammarId);
    if (!entry) {
      return (
        <EmptyState title="Grammar point not found" action={<Link className="btn-primary" to="/grammar">All grammar</Link>}>
          This grammar point isn't in the installed lessons.
        </EmptyState>
      );
    }
    return <GrammarDetail entry={entry} />;
  }
  return <GrammarList entries={entries} />;
}

const href = (e: GrammarEntry) => `/grammar/${e.unit.id}/${e.point.id}`;

function GrammarList({ entries }: { entries: GrammarEntry[] }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchGrammar(entries, query), [entries, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-5">
      <header>
        <Link to="/learn" className="text-sm text-accent hover:underline">
          ← Learn
        </Link>
        <h1 className="mt-1 text-xl font-bold">Grammar reference</h1>
        <p className="text-sm text-muted">Every grammar point from the installed lessons, by level and unit.</p>
      </header>

      <div role="search">
        <label htmlFor="grammar-search" className="label">
          Search grammar
        </label>
        <input
          id="grammar-search"
          type="search"
          className="input"
          placeholder="e.g. sein, word order, Dativ"
          value={query}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p role="status" className="mt-1 text-xs text-muted">
          {searching ? `${results.length} grammar point${results.length === 1 ? '' : 's'} found` : `${entries.length} grammar points`}
        </p>
      </div>

      {searching ? (
        results.length === 0 ? (
          <p className="text-sm text-muted">Nothing matches “{query}”. Try another word, or fewer words.</p>
        ) : (
          <ul className="space-y-2" aria-label="Search results">
            {results.map((e) => (
              <li key={`${e.unit.id}/${e.point.id}`}>
                <EntryLink entry={e} query={query} />
              </li>
            ))}
          </ul>
        )
      ) : (
        LEVELS.filter((l) => entries.some((e) => e.level === l)).map((level) => {
          const units = [...new Map(entries.filter((e) => e.level === level).map((e) => [e.unit.id, e.unit])).values()];
          return (
            <section key={level} aria-labelledby={`gl-${level}`} className="space-y-3">
              <h2 id={`gl-${level}`} className="text-lg font-semibold">
                {level}
              </h2>
              {units.map((u) => (
                <div key={u.id} className="card space-y-2">
                  <h3 className="text-sm font-semibold">
                    <Link to={`/unit/${u.id}/grammatik`} className="hover:underline">
                      Unit {u.number} · <span lang="de">{u.title}</span>
                    </Link>
                  </h3>
                  <ul className="space-y-1" aria-label={`Unit ${u.number} grammar`}>
                    {entries
                      .filter((e) => e.unit.id === u.id)
                      .map((e) => (
                        <li key={e.point.id}>
                          <Link to={href(e)} className="text-accent hover:underline">
                            {e.point.title}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function EntryLink({ entry: e, query }: { entry: GrammarEntry; query: string }) {
  return (
    <Link to={href(e)} className="card block py-3 transition-colors hover:border-accent">
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
        {e.level} · Unit {e.unit.number}
      </span>
      <span className="block font-semibold">{e.point.title}</span>
      <span className="block text-sm text-muted">{excerpt(e.point, query)}</span>
    </Link>
  );
}

function GrammarDetail({ entry }: { entry: GrammarEntry }) {
  const { point, unit } = entry;
  const practice = exercisesFor(unit, point.id);
  return (
    <div className="space-y-4">
      <Link to="/grammar" className="text-sm text-accent hover:underline">
        ← All grammar
      </Link>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {unit.level} · Unit {unit.number} · <span lang="de">{unit.title}</span>
      </p>
      <GrammarPointCard point={point} headingLevel={1} />
      <section className="card space-y-2" aria-labelledby="practise-title">
        <h2 id="practise-title" className="font-semibold">
          Practise this
        </h2>
        {practice.length === 0 ? (
          <p className="text-sm text-muted">
            No exercise is tagged with this point yet.{' '}
            <Link to={`/unit/${unit.id}/uebungen`} className="text-accent hover:underline">
              Open the unit's exercises
            </Link>
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {practice.map(({ ex, step }) => (
              <li key={ex.id} className="flex items-baseline gap-2">
                <VarietyTag variety={ex.variety} />
                <Link to={`/unit/${unit.id}/${step}?item=${ex.id}`} className="text-accent hover:underline">
                  {ex.prompt}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="pt-1 text-sm">
          <Link to={`/unit/${unit.id}/grammatik`} className="text-accent hover:underline">
            Back to unit {unit.number}: <span lang="de">{unit.title}</span>
          </Link>
        </p>
      </section>
    </div>
  );
}
