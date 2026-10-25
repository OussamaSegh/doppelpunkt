import { describe, expect, it } from 'vitest';
import { loadPacks } from './content';
import { fixturePack } from './test/fixtures';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('loadPacks', () => {
  it('reports empty when index.json is missing', async () => {
    const res = await loadPacks(async () => new Response('not found', { status: 404 }));
    expect(res.status).toBe('empty');
  });

  it('treats an HTML fallback page as missing', async () => {
    const res = await loadPacks(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    expect(res.status).toBe('empty');
  });

  it('loads and validates listed packs', async () => {
    const fetchImpl = async (url: RequestInfo | URL) =>
      String(url).endsWith('index.json')
        ? json({ packs: [{ level: 'A1', version: 'test', file: 'a1.json', units: 1 }] })
        : json(fixturePack);
    const res = await loadPacks(fetchImpl as typeof fetch);
    expect(res.status).toBe('ready');
    expect(res.packs[0]?.units[0]?.id).toBe('a1-u01');
  });

  it('skips invalid packs with a warning', async () => {
    const fetchImpl = async (url: RequestInfo | URL) =>
      String(url).endsWith('index.json')
        ? json({ packs: [{ level: 'A1', version: 'test', file: 'a1.json', units: 1 }] })
        : json({ level: 'A1' });
    const res = await loadPacks(fetchImpl as typeof fetch);
    expect(res.status).toBe('empty');
    expect(res.warnings[0]).toMatch(/a1.json/);
  });
});
