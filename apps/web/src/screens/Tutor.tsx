import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PROVIDER_LABELS, TUTOR_INFO, tutorSystemPrompt, type ProviderId, type TutorId } from '@doppelpunkt/ai';
import { ChatPanel } from '../components/ChatPanel';
import { EmptyState } from '../components/EmptyState';
import { allUnits, useContent, useEnsureContent } from '../content';
import { aiUnavailableMessage, monthSpend, PROVIDERS, useAi } from '../lib/ai';
import { useSettings } from '../lib/hooks';
import { useSession } from '../lib/session';

const TUTORS: TutorId[] = ['lena', 'keller', 'reto', 'explainer'];

export function Tutor() {
  const settings = useSettings();
  const keys = useSession((s) => s.keys);
  useEnsureContent();
  const packs = useContent((s) => s.packs);
  const unlocked = PROVIDERS.filter((p) => keys[p]);
  const [tutor, setTutor] = useState<TutorId>('lena');
  const [providerId, setProviderId] = useState<ProviderId>();
  const [unitId, setUnitId] = useState('');
  const [sessionCost, setSessionCost] = useState(0);
  const chosen = providerId && keys[providerId] ? providerId : undefined;
  const ai = useAi('tutor', chosen);
  // Re-read the month's spend whenever usage rows change.
  const spent = useLiveQuery(() => monthSpend(), []);

  if (!settings) return null;
  const units = allUnits(packs);
  const unit = units.find((u) => u.id === unitId);

  if (ai.status !== 'ready') {
    return (
      <EmptyState title="Talk with a tutor" action={<Link className="btn-primary" to="/settings">Open Settings</Link>}>
        {aiUnavailableMessage(ai)} Tutors use your own AI key; messages go straight from this device to the provider.
      </EmptyState>
    );
  }

  const system = tutorSystemPrompt(tutor, { level: settings.level, unit, dialect: settings.dialect });
  const cap = settings.monthlyCapUsd;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Tutor</h1>
      <div role="radiogroup" aria-label="Tutor" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TUTORS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tutor === t}
            onClick={() => setTutor(t)}
            className={`card p-3 text-left ${tutor === t ? (t === 'reto' ? 'border-swiss ring-2 ring-swiss/30' : 'border-accent ring-2 ring-accent/30') : ''}`}
          >
            <span className="block font-semibold">{TUTOR_INFO[t].name}</span>
            <span className="block text-xs text-muted">{TUTOR_INFO[t].role}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tutor-provider" className="label">
            Provider
          </label>
          <select id="tutor-provider" className="input" value={ai.providerId} onChange={(e) => setProviderId(e.target.value as ProviderId)}>
            {unlocked.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]} · {p === ai.providerId ? ai.model : (settings.models[p] ?? 'default')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tutor-unit" className="label">
            Topic (optional)
          </label>
          <select id="tutor-unit" className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Free conversation ({settings.level})</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.level} · {u.number}. {u.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <CostMeter session={sessionCost} month={spent ?? 0} cap={cap} />

      <ChatPanel
        key={`${tutor}-${ai.providerId}-${unitId}`}
        provider={ai.provider}
        system={system}
        onCost={(usd) => setSessionCost((c) => c + usd)}
        placeholder={tutor === 'explainer' ? 'Ask anything about German…' : tutor === 'reto' ? 'Schriib öppis …' : 'Schreib etwas …'}
      />
      <p className="text-xs text-muted">Conversations are not saved. Costs are approximate.</p>
    </div>
  );
}

function CostMeter({ session, month, cap }: { session: number; month: number; cap: number }) {
  const pct = cap > 0 ? Math.min(1, month / cap) : 1;
  return (
    <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm" role="group" aria-label="AI cost">
      <span>
        This chat: <strong className="tabular-nums">${session.toFixed(4)}</strong>
      </span>
      <span>
        This month: <strong className="tabular-nums">${month.toFixed(3)}</strong> of ${cap.toFixed(2)}
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label="Monthly budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <div className={`h-full ${pct > 0.9 ? 'bg-swiss' : 'bg-gold'}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
