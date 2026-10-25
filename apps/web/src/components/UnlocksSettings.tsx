// Settings → Unlocks: the license tokens on this device and what they unlock.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { productFor } from '@doppelpunkt/license';
import { db } from '../db';
import { billingActive } from '../lib/billing/config';
import { useEntitlements, VERIFY_MESSAGES, type VerifiedLicense } from '../lib/billing/entitlements';

const SOURCE: Record<string, string> = {
  checkout: 'bought',
  code: 'book code',
  restore: 'restored',
  token: 'added by token',
  import: 'imported',
};

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function UnlocksSettings() {
  const ent = useEntitlements();
  if (!billingActive()) {
    return (
      <p className="card text-sm" role="status">
        Payments are not set up in this version of the app: every level is unlocked.
      </p>
    );
  }
  const levels = [...ent.levels].sort();
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Unlocked: <span className="font-semibold">{['A1 (free)', ...levels].join(', ')}</span>. Unit 1 of every other level is a free preview.
      </p>
      {ent.ready && ent.licenses.length > 0 && (
        <ul className="space-y-2" aria-label="Unlock tokens on this device">
          {ent.licenses.map((l) => (
            <li key={l.row.pid}>
              <LicenseCard license={l} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to="/unlock" className="btn-primary">
          Unlock levels
        </Link>
        <Link to="/unlock#u-restore" className="btn-secondary">
          Restore a purchase
        </Link>
      </div>
      <p className="text-xs text-muted">
        Tokens contain only a random purchase id, the product and the dates, no personal data. They are included in "Export progress", and
        "Reset everything" deletes them, so keep your purchase id (on the Stripe receipt) or a copied token.
      </p>
    </div>
  );
}

function LicenseCard({ license }: { license: VerifiedLicense }) {
  const { row, payload, problem } = license;
  const [copied, setCopied] = useState(false);
  const name = productFor(row.sku)?.name ?? row.sku;
  const expires = payload?.exp ? new Date(payload.exp * 1000).toISOString() : row.expiresAt;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(row.token);
      setCopied(true);
    } catch {
      /* clipboard blocked */
    }
  };
  const remove = async () => {
    if (!confirm(`Remove "${name}" from this device? Copy the token first if you want to add it again later.`)) return;
    await db.licenses.delete(row.pid);
  };
  return (
    <div className={`card space-y-1 text-sm ${problem ? 'border-bad/40' : ''}`} role="group" aria-label={name}>
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{name}</span>
        <span className={problem ? 'text-bad' : 'text-ok'}>{problem ? (problem === 'expired' ? 'Expired' : 'Not valid') : `Unlocks ${(payload?.lv ?? row.levels).join(', ')}`}</span>
      </p>
      <p className="text-xs text-muted">
        {SOURCE[row.source] ?? row.source} {date(row.addedAt)}
        {expires ? ` · ${problem === 'expired' ? 'expired' : 'valid until'} ${date(expires)}` : ' · no expiry'} · purchase id <code>{row.pid}</code>
      </p>
      {problem && problem !== 'expired' && <p className="text-xs text-bad">{VERIFY_MESSAGES[problem]}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void copy()}>
          {copied ? 'Token copied' : 'Copy token'}
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs text-bad" onClick={() => void remove()}>
          Remove
        </button>
      </div>
    </div>
  );
}
