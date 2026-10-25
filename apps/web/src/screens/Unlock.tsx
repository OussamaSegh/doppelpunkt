// /unlock, /unlock/:level: buy a level or the yearly pass (Stripe Checkout), redeem a book code,
// restore a purchase. /unlock/done is where Stripe sends the learner back. Lazy-loaded.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { checkCode, formatPrice, productFor, SOLD_PRODUCTS, type LicensePayload, type Product } from '@doppelpunkt/license';
import { useContent, useEnsureContent } from '../content';
import { billingActive } from '../lib/billing/config';
import { addLicense, canOpenLevel, useEntitlements, VERIFY_MESSAGES, type EntitlementState } from '../lib/billing/entitlements';
import { BillingError, claimCheckout, redeemCode, restorePurchase, startCheckout } from '../lib/billing/api';

type Msg = { ok: boolean; text: string };

const CODE_PROBLEMS = {
  length: 'A book code has 15 characters, like B1K7M-3QXRT-4WPH9.',
  characters: 'A book code has only letters and digits.',
  checksum: 'This code has a typo. Check each character and try again.',
  'unknown-book': 'This is not a Doppelpunkt book code.',
} as const;

const errorText = (e: unknown) => (e instanceof BillingError || e instanceof Error ? e.message : String(e));

export function unlockedText(p: LicensePayload): string {
  const name = productFor(p.sku)?.name ?? p.sku;
  const until = p.exp ? ` until ${new Date(p.exp * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
  return `${p.lv.join(', ')} unlocked${until} (${name}). Thank you!`;
}

export function Unlock() {
  const { level } = useParams();
  const [search] = useSearchParams();
  const ent = useEntitlements();
  if (!billingActive()) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Unlock levels</h1>
        <p className="card text-sm" role="status">
          Payments are not set up in this version of the app, so every level is already unlocked.
        </p>
        <Link to="/learn" className="btn-primary">
          Back to Learn
        </Link>
      </div>
    );
  }
  if (level === 'done') return <CheckoutDone sessionId={search.get('session_id') ?? ''} />;
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Unlock levels</h1>
        <p className="text-sm text-muted">
          A1 is free, and unit 1 of every level is a free preview. Unlocks are stored on this device as a signed token: they work offline and need
          no account.
        </p>
        <UnlockedSummary ent={ent} />
      </header>
      {search.get('cancelled') && (
        <p className="card text-sm" role="status">
          Checkout cancelled. Nothing was charged.
        </p>
      )}
      <Section id="buy" title="Buy">
        <Catalog ent={ent} focus={level} />
      </Section>
      <Section id="book" title="Enter book code">
        <BookCode />
      </Section>
      <Section id="restore" title="Restore a purchase">
        <Restore />
      </Section>
      <p className="text-xs text-muted">
        Payments are handled by Stripe. We never see your card details. See the <Link to="/privacy" className="underline">privacy policy</Link> and the{' '}
        <Link to="/terms" className="underline">terms of use</Link>.
      </p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`u-${id}`} className="space-y-3">
      <h2 id={`u-${id}`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function UnlockedSummary({ ent }: { ent: EntitlementState }) {
  if (!ent.ready) return null;
  const levels = [...ent.levels].sort();
  return (
    <p className="text-sm" role="status" aria-label="Unlocked on this device">
      Unlocked on this device: <span className="font-semibold">{['A1 (free)', ...levels].join(', ')}</span>
    </p>
  );
}

function Catalog({ ent, focus }: { ent: EntitlementState; focus?: string }) {
  useEnsureContent();
  const packs = useContent((s) => s.packs);
  const status = useContent((s) => s.status);
  const available = new Set(packs.map((p) => p.level));
  // Only levels that have lessons are sold one by one; the pass covers future levels too.
  const products = SOLD_PRODUCTS.filter((p) => p.kind === 'pass' || (status === 'ready' ? p.levels.every((l) => available.has(l)) : true));
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<Msg>();

  const buy = async (p: Product) => {
    setBusy(p.sku);
    setMsg(undefined);
    try {
      window.location.assign(await startCheckout(p.sku));
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
      setBusy(undefined);
    }
  };

  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Products">
        {products.map((p) => {
          const owned = p.levels.every((l) => canOpenLevel(l, ent));
          return (
            <li key={p.sku} className={`card space-y-2 ${focus && p.levels.includes(focus as never) && p.kind === 'level' ? 'border-accent' : ''}`}>
              <h3 className="flex items-center justify-between gap-2 font-semibold">
                <span>{p.name}</span>
                {p.price && <span className="tabular-nums text-gold-strong">{formatPrice(p.price)}</span>}
              </h3>
              <p className="text-sm text-muted">{p.description}</p>
              {owned ? (
                <p className="text-sm text-ok">
                  <span aria-hidden="true">✓ </span>Unlocked on this device
                </p>
              ) : (
                <button type="button" className="btn-primary" disabled={!!busy} onClick={() => void buy(p)} aria-label={`Buy ${p.name}`}>
                  {busy === p.sku ? 'Opening checkout…' : `Buy for ${formatPrice(p.price!)}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <Message msg={msg} />}
    </div>
  );
}

function Message({ msg }: { msg: Msg }) {
  return (
    <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>
      {msg.text}
    </p>
  );
}

function BookCode() {
  const uid = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(undefined);
    const check = checkCode(code);
    if (!check.ok) return setMsg({ ok: false, text: CODE_PROBLEMS[check.reason] });
    setBusy(true);
    try {
      const r = await redeemCode(check.code);
      setCode('');
      setMsg({ ok: true, text: unlockedText(r.payload) });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-2">
      <label htmlFor={`${uid}-code`} className="label">
        Book access code
      </label>
      <p id={`${uid}-hint`} className="text-xs text-muted">
        Printed inside Book 1 <span lang="de">"Doppelpunkt 1: Ankommen"</span>. It unlocks A2. Upper or lower case, dashes optional.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${uid}-code`}
          aria-describedby={`${uid}-hint`}
          className="input min-w-48 flex-1 font-mono uppercase tracking-wider"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="B1XXX-XXXXX-XXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Redeem code'}
        </button>
      </div>
      {msg && <Message msg={msg} />}
    </form>
  );
}

function Restore() {
  const uid = useId();
  const [email, setEmail] = useState('');
  const [ref, setRef] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>();
  const [tokenMsg, setTokenMsg] = useState<Msg>();

  const byEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await restorePurchase(email, ref);
      setMsg({ ok: true, text: unlockedText(r.payload) });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const byToken = async (e: FormEvent) => {
    e.preventDefault();
    setTokenMsg(undefined);
    const r = await addLicense(token, 'token');
    if (!r.ok) return setTokenMsg({ ok: false, text: VERIFY_MESSAGES[r.reason] });
    setToken('');
    setTokenMsg({ ok: true, text: unlockedText(r.payload) });
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <form onSubmit={byEmail} className="card space-y-2" aria-labelledby={`${uid}-email-title`}>
        <h3 id={`${uid}-email-title`} className="font-semibold">
          With your email and purchase id
        </h3>
        <p className="text-xs text-muted">
          The purchase id (<code>dp_…</code>) is on your Stripe receipt and was shown after checkout. The checkout reference (<code>cs_…</code>)
          works too.
        </p>
        <div>
          <label htmlFor={`${uid}-email`} className="label">
            Email used at checkout
          </label>
          <input id={`${uid}-email`} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={`${uid}-ref`} className="label">
            Purchase id
          </label>
          <input id={`${uid}-ref`} className="input font-mono" autoComplete="off" spellCheck={false} placeholder="dp_…" value={ref} onChange={(e) => setRef(e.target.value)} required />
        </div>
        <button type="submit" className="btn-secondary" disabled={busy || !email.trim() || !ref.trim()}>
          {busy ? 'Restoring…' : 'Restore purchase'}
        </button>
        {msg && <Message msg={msg} />}
      </form>
      <form onSubmit={(e) => void byToken(e)} className="card space-y-2" aria-labelledby={`${uid}-token-title`}>
        <h3 id={`${uid}-token-title`} className="font-semibold">
          With your unlock token
        </h3>
        <p className="text-xs text-muted">Copied from Settings → Unlocks on another device. Works offline.</p>
        <label htmlFor={`${uid}-token`} className="label">
          Unlock token
        </label>
        <textarea
          id={`${uid}-token`}
          className="input h-24 font-mono text-xs"
          spellCheck={false}
          placeholder="DP1.…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <button type="submit" className="btn-secondary" disabled={!token.trim()}>
          Add token
        </button>
        {tokenMsg && <Message msg={tokenMsg} />}
      </form>
    </div>
  );
}

const CLAIM_TRIES = 6;
const CLAIM_DELAY_MS = 2_000;

/** Stripe sends the learner back here with ?session_id=cs_…; the webhook may still be on its way, so poll a few times. */
function CheckoutDone({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<{ kind: 'working' } | { kind: 'pending' } | { kind: 'done'; payload: LicensePayload; token: string } | { kind: 'error'; text: string }>({
    kind: 'working',
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!/^cs_\w+$/.test(sessionId)) return setState({ kind: 'error', text: 'This page needs the checkout reference from Stripe. Use "Restore a purchase" instead.' });
    void (async () => {
      for (let i = 0; i < CLAIM_TRIES; i++) {
        try {
          const r = await claimCheckout(sessionId);
          if (!r.pending) return setState({ kind: 'done', payload: r.payload, token: r.row.token });
          setState({ kind: 'pending' });
        } catch (e) {
          return setState({ kind: 'error', text: errorText(e) });
        }
        await new Promise((res) => setTimeout(res, CLAIM_DELAY_MS));
      }
    })();
  }, [sessionId]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Thank you</h1>
      {state.kind === 'working' && <p role="status">Unlocking…</p>}
      {state.kind === 'pending' && (
        <p role="status" className="card text-sm">
          Your payment is still being processed. This page checks again for a few seconds; you can also come back later and use{' '}
          <Link to="/unlock#u-restore" className="underline">Restore a purchase</Link> with checkout reference <code>{sessionId}</code>.
        </p>
      )}
      {state.kind === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-bad">
            {state.text}
          </p>
          <Link to="/unlock" className="btn-secondary">
            Back to Unlock
          </Link>
        </div>
      )}
      {state.kind === 'done' && <Receipt payload={state.payload} token={state.token} />}
    </div>
  );
}

function Receipt({ payload, token }: { payload: LicensePayload; token: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <p role="status" className="card border-ok/40 text-ok">
        <span aria-hidden="true">✓ </span>
        {unlockedText(payload)}
      </p>
      <div className="card space-y-2 text-sm">
        <p>
          Your purchase id: <code className="font-mono">{payload.pid}</code>
        </p>
        <p className="text-muted">
          It is also on your Stripe receipt. With it and your email you can restore this purchase on another device (Unlock → Restore a purchase),
          or copy the unlock token and paste it there.
        </p>
        <button type="button" className="btn-secondary" onClick={() => void copy()}>
          {copied ? 'Token copied' : 'Copy unlock token'}
        </button>
      </div>
      <Link to={`/learn/${payload.lv[0] ?? 'A2'}`} className="btn-primary">
        Start {payload.lv[0] ?? 'learning'}
      </Link>
      <p className="text-xs text-muted">The unlock is saved on this device and works offline.</p>
    </div>
  );
}
