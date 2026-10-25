import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_MODELS, decryptKey, encryptKey, PROVIDER_KEY_URLS, PROVIDER_LABELS, type ProviderId } from '@doppelpunkt/ai';
import {
  db,
  exportProgress,
  importProgress,
  isProgressExport,
  resetAll,
  updateSettings,
  type Dialect,
  type Settings,
  type ThemePref,
} from '../db';
import { errorMessage, modelFor, monthSpend, monthTranscription, PROVIDERS } from '../lib/ai';
import { useSettings } from '../lib/hooks';
import { useSession } from '../lib/session';
import { applyTheme } from '../lib/theme';
import { BetaSettings } from '../beta/BetaSettings';
import { UnlocksSettings } from '../components/UnlocksSettings';
import { Link } from 'react-router-dom';


export function SettingsScreen() {
  const settings = useSettings();
  if (!settings) return <p role="status">Loading settings…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <Section title="AI tutor keys" id="ai">
        <p className="text-sm text-muted">
          Keys are encrypted with your passphrase (AES-GCM) and stored only on this device. They are unlocked into memory for this tab
          and sent only to the provider you choose{settings.relayUrl ? ' (through your relay)' : ''}.
        </p>
        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <ProviderCard key={p} provider={p} settings={settings} />
          ))}
        </div>
        <RelayAndCap settings={settings} />
      </Section>
      <Section title="Unlocks" id="unlocks">
        <UnlocksSettings />
      </Section>
      <Section title="Learning" id="learning">
        <LearningPrefs settings={settings} />
      </Section>
      <Section title="Appearance" id="appearance">
        <ThemePicker value={settings.theme} />
      </Section>
      <Section title="Your data" id="data">
        <DataTools />
      </Section>
      <Section title="Help improve Doppelpunkt (beta)" id="beta">
        <BetaSettings settings={settings} />
      </Section>
      <Section title="About and legal" id="legal">
        <nav aria-label="About and legal" className="card flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link to="/about" className="text-accent underline">
            About Doppelpunkt
          </Link>
          <Link to="/privacy" className="text-accent underline">
            Privacy policy
          </Link>
          <Link to="/terms" className="text-accent underline">
            Terms of use
          </Link>
          <Link to="/imprint" className="text-accent underline">
            Imprint
          </Link>
        </nav>
      </Section>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`s-${id}`} className="space-y-3">
      <h2 id={`s-${id}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProviderCard({ provider, settings }: { provider: ProviderId; settings: Settings }) {
  const uid = useId();
  const saved = useLiveQuery(() => db.aiKeys.get(provider), [provider]);
  const unlocked = useSession((s) => !!s.keys[provider]);
  const unlock = useSession((s) => s.unlock);
  const lock = useSession((s) => s.lock);
  const [apiKey, setApiKey] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const active = settings.activeProvider === provider;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(undefined);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
      setPass('');
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      const payload = await encryptKey(apiKey.trim(), pass);
      await db.aiKeys.put({ provider, payload, createdAt: new Date().toISOString() });
      unlock(provider, apiKey.trim());
      setApiKey('');
      if (!settings.activeProvider) await updateSettings({ activeProvider: provider });
      return 'Key saved and unlocked.';
    });
  };

  const doUnlock = (e: FormEvent) => {
    e.preventDefault();
    if (!saved) return;
    void run(async () => {
      try {
        unlock(provider, await decryptKey(saved.payload, pass));
      } catch {
        throw new Error('Wrong passphrase.');
      }
      return 'Unlocked for this session.';
    });
  };

  const forget = () =>
    void run(async () => {
      await db.aiKeys.delete(provider);
      lock(provider);
      if (active) await updateSettings({ activeProvider: undefined });
      return 'Key removed from this device.';
    });

  return (
    <div role="group" aria-labelledby={`${uid}-title`} className={`card space-y-3 ${active ? 'border-accent' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${uid}-title`} className="font-semibold">
          {PROVIDER_LABELS[provider]}
        </h3>
        <span className={`chip text-xs ${unlocked ? 'border-ok/40 text-ok' : saved ? 'border-gold/40 text-gold-strong' : 'text-muted'}`}>
          {unlocked ? 'Unlocked' : saved ? 'Locked' : 'No key'}
        </span>
      </div>

      {saved && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="active-provider"
            checked={active}
            onChange={() => void updateSettings({ activeProvider: provider })}
            className="h-5 w-5"
          />
          Use for feedback and explanations
        </label>
      )}

      <ModelPicker provider={provider} settings={settings} />

      {!saved && (
        <form onSubmit={save} className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-key`} className="label">
              API key
            </label>
            <input id={`${uid}-key`} className="input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
          </div>
          <div>
            <label htmlFor={`${uid}-pass`} className="label">
              Passphrase
            </label>
            <input id={`${uid}-pass`} className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} required />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy || !apiKey.trim() || !pass}>
              Save key
            </button>
            <a href={PROVIDER_KEY_URLS[provider]} target="_blank" rel="noreferrer noopener" className="text-sm text-accent underline">
              Get a key
            </a>
          </div>
        </form>
      )}

      {saved && !unlocked && (
        <form onSubmit={doUnlock} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor={`${uid}-unlock`} className="label">
              Passphrase
            </label>
            <input id={`${uid}-unlock`} className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !pass}>
            Unlock
          </button>
        </form>
      )}

      {saved && (
        <div className="flex flex-wrap gap-2">
          {unlocked && (
            <button type="button" className="btn-secondary" onClick={() => lock(provider)}>
              Lock
            </button>
          )}
          <button type="button" className="btn-ghost text-bad" onClick={forget} disabled={busy}>
            Forget key
          </button>
        </div>
      )}

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

const CUSTOM = '__custom__';

function ModelPicker({ provider, settings }: { provider: ProviderId; settings: Settings }) {
  const uid = useId();
  const options = DEFAULT_MODELS[provider] ?? [];
  const current = modelFor(settings, provider);
  const isCustom = !options.includes(current);
  const [custom, setCustom] = useState(isCustom ? current : '');
  const [showCustom, setShowCustom] = useState(isCustom);

  const setModel = (model: string) => void updateSettings({ models: { ...settings.models, [provider]: model } });

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor={`${uid}-model`} className="label">
          Model
        </label>
        <select
          id={`${uid}-model`}
          className="input"
          value={showCustom ? CUSTOM : current}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setShowCustom(true);
            else {
              setShowCustom(false);
              setModel(e.target.value);
            }
          }}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={CUSTOM}>Custom model id…</option>
        </select>
      </div>
      {showCustom && (
        <div>
          <label htmlFor={`${uid}-custom`} className="label">
            Custom model id
          </label>
          <input
            id={`${uid}-custom`}
            className="input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onBlur={() => custom.trim() && setModel(custom.trim())}
          />
        </div>
      )}
    </div>
  );
}

function formatAudio(seconds: number): string {
  return seconds < 60 ? `${Math.round(seconds)} s of audio` : `${(seconds / 60).toFixed(1)} min of audio`;
}

function RelayAndCap({ settings }: { settings: Settings }) {
  const [relay, setRelay] = useState(settings.relayUrl ?? '');
  const [cap, setCap] = useState(String(settings.monthlyCapUsd));
  const [relayError, setRelayError] = useState<string>();
  const spent = useLiveQuery(() => monthSpend(), []);
  const transcribed = useLiveQuery(() => monthTranscription(), []);

  const saveRelay = () => {
    const v = relay.trim();
    if (v && !/^https:\/\/[^\s/]+/.test(v)) return setRelayError('The relay URL must start with https://');
    setRelayError(undefined);
    void updateSettings({ relayUrl: v || undefined });
  };

  return (
    <div className="card grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="relay-url" className="label">
          Relay URL (optional)
        </label>
        <input id="relay-url" className="input" type="url" placeholder="https://relay.example.workers.dev" value={relay} onChange={(e) => setRelay(e.target.value)} onBlur={saveRelay} />
        {relayError ? <p className="mt-1 text-xs text-bad">{relayError}</p> : <p className="mt-1 text-xs text-muted">Use one if your browser blocks direct calls to a provider.</p>}
      </div>
      <div>
        <label htmlFor="spend-cap" className="label">
          Monthly spend cap (USD)
        </label>
        <input
          id="spend-cap"
          className="input"
          type="number"
          min={0}
          step={0.5}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => {
            const n = Number(cap);
            if (Number.isFinite(n) && n >= 0) void updateSettings({ monthlyCapUsd: n });
          }}
        />
        <p className="mt-1 text-xs text-muted">
          Spent this month: about ${(spent ?? 0).toFixed(3)}
          {transcribed && transcribed.seconds > 0
            ? `, of which speech transcription about $${transcribed.costUsd.toFixed(3)} (${formatAudio(transcribed.seconds)})`
            : ''}
          . 0 switches AI off.
        </p>
      </div>
    </div>
  );
}

function LearningPrefs({ settings }: { settings: Settings }) {
  return (
    <div className="card grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="dialect" className="label">
          Swiss German dialect
        </label>
        <select id="dialect" className="input" value={settings.dialect} onChange={(e) => void updateSettings({ dialect: e.target.value as Dialect })}>
          <option value="gsw-zh">Zurich (Züritüütsch)</option>
          <option value="gsw-be">Bern (Bärndütsch)</option>
        </select>
      </div>
      <div>
        <label htmlFor="goal" className="label">
          Daily goal
        </label>
        <select id="goal" className="input" value={settings.dailyGoalMin} onChange={(e) => void updateSettings({ dailyGoalMin: Number(e.target.value) })}>
          {[5, 10, 15, 20, 30, 45, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={settings.haptics}
          onChange={(e) => void updateSettings({ haptics: e.target.checked })}
        />
        <span>
          Vibrate on right and wrong answers
          <span className="block text-xs text-muted">On phones that support it. Off automatically when your system asks for reduced motion.</span>
        </span>
      </label>
    </div>
  );
}

function ThemePicker({ value }: { value: ThemePref }) {
  const choose = (t: ThemePref) => {
    applyTheme(t);
    void updateSettings({ theme: t });
  };
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-2">
      {(['system', 'light', 'dark'] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => choose(t)}
          className={`chip px-4 py-2 capitalize ${value === t ? 'border-accent bg-accent-soft text-accent' : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function DataTools() {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const lockAll = useSession((s) => s.lock);

  const doExport = async () => {
    const data = await exportProgress();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `doppelpunkt-progress-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg({ ok: true, text: 'Progress exported. AI keys are not included.' });
  };

  const doImport = async (f: File) => {
    try {
      const data: unknown = JSON.parse(await f.text());
      if (!isProgressExport(data)) throw new Error('This is not a Doppelpunkt progress file.');
      if (!confirm('Replace your current progress with this file?')) return;
      await importProgress(data);
      setMsg({ ok: true, text: 'Progress imported.' });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const doReset = async () => {
    if (!confirm('Delete all progress, settings, saved keys and unlocks on this device? This cannot be undone.')) return;
    lockAll();
    // Beta: ask the collector to forget this install before the id disappears with the data.
    await import('../lib/beta/prefs').then((m) => m.setStatsOptIn(false)).catch(() => undefined);
    await resetAll();
    try {
      localStorage.removeItem('dp-theme');
    } catch {
      /* ignore */
    }
    window.location.assign(import.meta.env.BASE_URL);
  };

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => void doExport()}>
          Export progress
        </button>
        <button type="button" className="btn-secondary" onClick={() => file.current?.click()}>
          Import progress
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Progress file to import"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn-ghost text-bad" onClick={() => void doReset()}>
          Reset everything
        </button>
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
