// Which levels this device has unlocked. Tokens live in Dexie (db.licenses) and are verified on the
// device with WebCrypto (Ed25519) against the public keys baked into the build, so this works
// offline and without an account. Without billing in the build everything is unlocked.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  levelUnlocked,
  unitUnlocked,
  UNGATED,
  unlockedLevels,
  verifyToken,
  type Entitlements,
  type LicensePayload,
  type VerifyFailure,
  type VerifyResult,
} from '@doppelpunkt/license';
import { db, type LicenseRow } from '../../db';
import { billingActive, publicKeys } from './config';

export type VerifiedLicense = { row: LicenseRow; payload?: LicensePayload; problem?: VerifyFailure };

export type EntitlementState = Entitlements & {
  /** false while the tokens on the device are still being checked (only when gated). */
  ready: boolean;
  licenses: VerifiedLicense[];
};

const OPEN: EntitlementState = { ...UNGATED, ready: true, licenses: [] };

// Verification results by token (the signature check doesn't change; expiry is re-checked below).
const verified = new Map<string, Promise<VerifyResult>>();
function verifyCached(token: string): Promise<VerifyResult> {
  const keys = publicKeys();
  const id = `${JSON.stringify(keys)}|${token}`;
  let p = verified.get(id);
  if (!p) {
    // "now" = 0: only the signature and format are cached; expiry is applied in verifyAll.
    p = verifyToken(token, keys, 0);
    verified.set(id, p);
  }
  return p;
}

export async function verifyAll(rows: LicenseRow[], now = Date.now()): Promise<EntitlementState> {
  const licenses = await Promise.all(
    rows.map(async (row): Promise<VerifiedLicense> => {
      const r = await verifyCached(row.token);
      if (!r.ok) return { row, problem: r.reason };
      if (r.payload.exp !== undefined && r.payload.exp * 1000 <= now) return { row, payload: r.payload, problem: 'expired' };
      return { row, payload: r.payload };
    }),
  );
  const valid = licenses.flatMap((l) => (l.payload && !l.problem ? [l.payload] : []));
  return { gated: true, ready: true, levels: unlockedLevels(valid, now), licenses };
}

/** Live entitlements for components. */
export function useEntitlements(): EntitlementState {
  const gated = billingActive();
  const rows = useLiveQuery(() => (gated ? db.licenses.toArray() : Promise.resolve([] as LicenseRow[])), [gated]);
  const [state, setState] = useState<EntitlementState>(gated ? { gated: true, ready: false, levels: new Set(), licenses: [] } : OPEN);
  useEffect(() => {
    if (!gated) return setState(OPEN);
    if (!rows) return;
    let live = true;
    void verifyAll(rows).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [gated, rows]);
  return state;
}

export const canOpenLevel = (level: string, ent: Entitlements) => levelUnlocked(level, ent);
export const canOpenUnit = (unit: { level: string; number: number }, ent: Entitlements) => unitUnlocked(unit, ent);

export type AddResult = { ok: true; payload: LicensePayload; row: LicenseRow } | { ok: false; reason: VerifyFailure };

/** Verifies a token and stores it. Adding the same purchase again replaces the stored token. */
export async function addLicense(token: string, source: LicenseRow['source']): Promise<AddResult> {
  const trimmed = token.trim();
  const r = await verifyToken(trimmed, publicKeys());
  if (!r.ok) return r;
  const p = r.payload;
  const row: LicenseRow = {
    pid: p.pid,
    token: trimmed,
    sku: p.sku,
    levels: [...p.lv],
    ...(p.exp !== undefined ? { expiresAt: new Date(p.exp * 1000).toISOString() } : {}),
    source,
    addedAt: new Date().toISOString(),
  };
  await db.licenses.put(row);
  return { ok: true, payload: p, row };
}

export const VERIFY_MESSAGES: Record<VerifyFailure, string> = {
  malformed: "This doesn't look like a Doppelpunkt unlock token. Copy the whole token, starting with DP1.",
  'unknown-key': 'This token was signed with a key this version of the app does not know. Update the app and try again.',
  'bad-signature': 'This token is not valid: its signature does not match.',
  expired: 'This token has expired.',
  unsupported: 'Your browser cannot check unlock tokens (it lacks Ed25519 in Web Crypto). Please update your browser.',
};
