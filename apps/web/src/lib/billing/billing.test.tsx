// Payments in the app: the gate, token storage and verification, the Learn lock badges, the Unlock
// screen and the Dexie v3 -> v4 upgrade. Tokens are signed with the public TEST key.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dexie from 'dexie';
import { CompiledUnit, type LevelPack } from '@doppelpunkt/content-schema';
import { formatCode, generateCode, importPrivateKey, payloadFor, signToken, type Sku } from '@doppelpunkt/license';
import { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_PUBLIC_KEYS_SPEC } from '@doppelpunkt/license/testing';
import { useContent } from '../../content';
import { db, DoppelpunktDB, exportProgress, importProgress, updateSettings } from '../../db';
import { fixtureUnit } from '../../test/fixtures';
import { Learn } from '../../screens/Learn';
import { Unlock } from '../../screens/Unlock';
import { billingActive, billingUrl } from './config';
import { addLicense, verifyAll } from './entitlements';
import { redeemCode, startCheckout } from './api';

const BILLING = 'https://billing.example.org';
let n = 0;
const pid = () => `dp_${String(++n).padStart(20, '0')}`;

async function token(sku: Sku, now = Date.now(), id = pid()): Promise<string> {
  return signToken(payloadFor(sku, { kid: TEST_KEY_ID, pid: id, now }), await importPrivateKey(TEST_PRIVATE_KEY));
}

function gate(on: boolean) {
  vi.stubEnv('VITE_BILLING_URL', on ? BILLING : '');
  vi.stubEnv('VITE_LICENSE_PUBLIC_KEYS', on ? TEST_PUBLIC_KEYS_SPEC : '');
}

const unitOf = (level: 'A1' | 'A2', num: number) => {
  const id = `${level.toLowerCase()}-u${String(num).padStart(2, '0')}`;
  return CompiledUnit.parse({ ...fixtureUnit, id, level, number: num, title: `${level} Einheit ${num}`, exercises: fixtureUnit.exercises.map((e) => ({ ...e, id: e.id.replace('a1-u01', id) })) });
};
const pack = (level: 'A1' | 'A2', count: number): LevelPack => ({
  level,
  version: 't',
  builtAt: '2026-01-01T00:00:00.000Z',
  units: Array.from({ length: count }, (_, i) => unitOf(level, i + 1)),
  exams: [],
});

beforeEach(async () => {
  await db.licenses.clear();
  await db.settings.clear();
  await updateSettings({ onboarded: true });
  useContent.getState().setPacks([pack('A1', 12), pack('A2', 3)]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the gate', () => {
  it('is off without a billing URL or without a public key', () => {
    gate(false);
    expect(billingActive()).toBe(false);
    vi.stubEnv('VITE_BILLING_URL', BILLING);
    expect(billingActive()).toBe(false);
    vi.stubEnv('VITE_LICENSE_PUBLIC_KEYS', TEST_PUBLIC_KEYS_SPEC);
    expect(billingActive()).toBe(true);
  });

  it('accepts only https billing URLs (http for localhost)', () => {
    vi.stubEnv('VITE_BILLING_URL', 'http://billing.example.org');
    expect(billingUrl()).toBeUndefined();
    vi.stubEnv('VITE_BILLING_URL', 'http://127.0.0.1:4339/');
    expect(billingUrl()).toBe('http://127.0.0.1:4339');
  });
});

describe('license tokens on the device', () => {
  beforeEach(() => gate(true));

  it('addLicense verifies and stores a token; verifyAll unlocks its levels', async () => {
    const r = await addLicense(await token('level-a2'), 'token');
    expect(r.ok).toBe(true);
    const rows = await db.licenses.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sku: 'level-a2', levels: ['A2'], source: 'token' });
    const ent = await verifyAll(rows);
    expect([...ent.levels]).toEqual(['A2']);
  });

  it('rejects forged and foreign tokens without storing them', async () => {
    const t = await token('pass-year');
    const forged = t.slice(0, -4) + (t.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await addLicense(forged, 'token')).toEqual({ ok: false, reason: 'bad-signature' });
    expect(await addLicense('hello', 'token')).toEqual({ ok: false, reason: 'malformed' });
    expect(await db.licenses.count()).toBe(0);
  });

  it('an expired pass stays listed but unlocks nothing', async () => {
    const old = Date.now() - 400 * 86_400_000;
    await db.licenses.put({ pid: 'dp_expired000000000000', token: await token('pass-year', old, 'dp_expired000000000000'), sku: 'pass-year', levels: ['A2'], source: 'checkout', addedAt: new Date(old).toISOString() });
    const ent = await verifyAll(await db.licenses.toArray());
    expect(ent.levels.size).toBe(0);
    expect(ent.licenses[0]?.problem).toBe('expired');
  });

  it('tokens travel with Export progress and are merged on import', async () => {
    await addLicense(await token('level-a2'), 'checkout');
    const file = await exportProgress();
    expect(file.tables.licenses).toHaveLength(1);
    await db.licenses.clear();
    await importProgress(JSON.parse(JSON.stringify(file)));
    expect((await db.licenses.toArray())[0]).toMatchObject({ sku: 'level-a2', source: 'import' });
    // An old export without licenses leaves the tokens alone.
    const { licenses: _drop, ...old } = file.tables;
    await importProgress({ ...file, tables: old as typeof file.tables });
    expect(await db.licenses.count()).toBe(1);
  });
});

describe('Dexie upgrade v3 -> v4', () => {
  it('keeps the existing data and adds the licenses table', async () => {
    const name = `upgrade-test-${Math.random()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({
      settings: 'key',
      attempts: '++id, exerciseId, unitId, level, skill, at',
      cards: 'id, unitId, due',
      unitStatus: 'unitId',
      aiKeys: 'provider',
      usage: '++id, at, provider',
      writingSubmissions: '++id, exerciseId, unitId, at',
      activity: 'day',
      examResults: '++id, examId, level, at',
      outbox: '++id, kind, createdAt',
      reports: '++id, outboxId, status',
      itemStats: 'itemId',
    });
    await v3.table('settings').put({ key: 'app', onboarded: true, level: 'A2' });
    await v3.table('activity').put({ day: '2026-10-01', seconds: 600 });
    v3.close();

    const v4 = new DoppelpunktDB(name);
    await v4.open();
    expect(v4.verno).toBe(4);
    expect(await v4.settings.get('app')).toMatchObject({ onboarded: true, level: 'A2' });
    expect(await v4.activity.get('2026-10-01')).toEqual({ day: '2026-10-01', seconds: 600 });
    expect(await v4.licenses.count()).toBe(0);
    v4.close();
    await Dexie.delete(name);
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn/:level" element={<Learn />} />
        <Route path="/unlock" element={<Unlock />} />
        <Route path="/unlock/:level" element={<Unlock />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Learn with payments', () => {
  it('without billing nothing is locked', async () => {
    gate(false);
    renderAt('/learn/A2');
    const list = await screen.findByRole('list', { name: 'A2 units' });
    expect(within(list).queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'A2 is locked' })).not.toBeInTheDocument();
  });

  it('A2 is locked except its free preview unit; A1 is open', async () => {
    gate(true);
    renderAt('/learn/A2');
    const note = await screen.findByRole('note', { name: 'A2 is locked' });
    expect(within(note).getByRole('link', { name: 'Unlock A2' })).toHaveAttribute('href', '/unlock/A2');
    const cards = within(screen.getByRole('list', { name: 'A2 units' })).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('Free preview');
    expect(cards[1]).toHaveTextContent('Locked');
    expect(cards[2]).toHaveTextContent('Locked');
    const levels = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(levels).getByRole('link', { name: /A2 preview locked/ })).toBeVisible();
    expect(within(levels).getByRole('link', { name: 'A1' })).toBeVisible();
  });

  it('a valid token removes the locks', async () => {
    gate(true);
    await addLicense(await token('level-a2'), 'token');
    renderAt('/learn/A2');
    const list = await screen.findByRole('list', { name: 'A2 units' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')[0]).not.toHaveTextContent('Free preview'));
    expect(within(list).queryByText('Locked')).not.toBeInTheDocument();
  });
});

describe('Unlock screen', () => {
  it('says everything is unlocked when payments are off', () => {
    gate(false);
    renderAt('/unlock');
    expect(screen.getByText(/every level is already unlocked/)).toBeVisible();
  });

  it('lists the products with prices from the catalog', async () => {
    gate(true);
    renderAt('/unlock/A2');
    const products = await screen.findByRole('list', { name: 'Products' });
    // A2 exists in the packs; B1–C2 don't, so only A2 and the pass are sold.
    expect(within(products).getAllByRole('listitem')).toHaveLength(2);
    expect(within(products).getByRole('button', { name: 'Buy A2 level' })).toHaveTextContent(/14\.90/);
    expect(within(products).getByRole('button', { name: 'Buy All levels for a year' })).toHaveTextContent(/39\.00/);
  });

  it('catches book-code typos on the device, then redeems a valid code', async () => {
    gate(true);
    const code = generateCode('B1');
    const t = await token('book-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe(`${BILLING}/v1/redeem`);
      expect(JSON.parse(String(init?.body))).toEqual({ code });
      return new Response(JSON.stringify({ token: t, pid: 'x', sku: 'book-1' }), { status: 200 });
    });
    renderAt('/unlock');
    const input = await screen.findByRole('textbox', { name: 'Book access code' });
    const typo = code.slice(0, 4) + (code[4] === 'A' ? 'B' : 'A') + code.slice(5);
    fireEvent.change(input, { target: { value: typo } });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('typo');
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: formatCode(code).toLowerCase() } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redeem code' }));
    });
    expect(await screen.findByText(/A2 unlocked .*Book 1/)).toBeVisible();
    expect(await db.licenses.count()).toBe(1);
  });

  it('adds a pasted token offline', async () => {
    gate(true);
    renderAt('/unlock');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Unlock token' }), { target: { value: await token('pass-year') } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add token' }));
    });
    expect(await screen.findByText(/A2, B1, B2, C1, C2 unlocked until/)).toBeVisible();
  });
});

describe('billing API client', () => {
  it('startCheckout returns the Stripe URL; errors carry the server message', async () => {
    gate(true);
    const f = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 }));
    expect(await startCheckout('level-a2', f as unknown as typeof fetch)).toBe('https://checkout.stripe.com/c/pay/cs_1');
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'We could not find this code.' } }), { status: 404 }));
    await expect(redeemCode(generateCode('B1'), bad as unknown as typeof fetch)).rejects.toThrow('We could not find this code.');
  });

  it('refuses a token the server sends if it does not verify', async () => {
    gate(true);
    const f = vi.fn(async () => new Response(JSON.stringify({ token: 'DP1.nope.nope', pid: 'x', sku: 'book-1' }), { status: 200 }));
    await expect(redeemCode(generateCode('B1'), f as unknown as typeof fetch)).rejects.toThrow(/doesn't look like/);
    expect(await db.licenses.count()).toBe(0);
  });
});
