import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LevelPack, PackIndex } from '@doppelpunkt/content-schema';
import { buildPacks } from '../src/build-packs';
import { exercises, makeFixture, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const opts = () => ({ contentDir: f.content, outDir: f.out, version: '0.1.0', root: f.root });
const readJson = (p: string) => JSON.parse(readFileSync(join(f.out, p), 'utf8')) as unknown;

describe('buildPacks', () => {
  it('writes an empty index when there is no content', () => {
    const r = buildPacks(opts());
    expect(r.ok).toBe(true);
    expect(readJson('index.json')).toEqual({ packs: [] });
  });
  it('compiles each level into a valid pack and index', () => {
    writeUnit(f, 'A1', 2);
    writeUnit(f, 'A1', 1);
    writeUnit(f, 'B1', 1);
    const r = buildPacks(opts());
    expect(r.ok).toBe(true);
    const index = PackIndex.parse(readJson('index.json'));
    expect(index.packs).toEqual([
      { level: 'A1', version: '0.1.0', file: 'a1.json', units: 2 },
      { level: 'B1', version: '0.1.0', file: 'b1.json', units: 1 },
    ]);
    const a1 = LevelPack.parse(readJson('a1.json'));
    expect(a1.units.map((u) => u.number)).toEqual([1, 2]);
    expect(a1.builtAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
  it('is deterministic', () => {
    writeUnit(f, 'A1', 1);
    buildPacks(opts());
    const first = readFileSync(join(f.out, 'a1.json'), 'utf8');
    buildPacks(opts());
    expect(readFileSync(join(f.out, 'a1.json'), 'utf8')).toBe(first);
    buildPacks({ ...opts(), builtAt: '2026-01-01T00:00:00.000Z' });
    expect((readJson('a1.json') as { builtAt: string }).builtAt).toBe('2026-01-01T00:00:00.000Z');
  });
  it('removes packs for levels that no longer exist', () => {
    mkdirSync(f.out, { recursive: true });
    writeFileSync(join(f.out, 'c2.json'), '{}');
    writeFileSync(join(f.out, 'keep.txt'), 'x');
    writeUnit(f, 'A1', 1);
    buildPacks(opts());
    expect(existsSync(join(f.out, 'c2.json'))).toBe(false);
    expect(existsSync(join(f.out, 'keep.txt'))).toBe(true);
  });
  it('refuses to build when lint finds errors', () => {
    writeUnit(f, 'A1', 1, { exercises: exercises('a1-u1').filter((e) => (e as { variety?: string }).variety !== 'gsw-zh') });
    const r = buildPacks(opts());
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/Not building packs/);
    expect(existsSync(join(f.out, 'index.json'))).toBe(false);
  });
});
