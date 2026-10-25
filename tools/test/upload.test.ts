import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LevelPack, PronunciationPack } from '@doppelpunkt/content-schema';
import { cdnLayout, groupHash, hashedName, publicUrl } from '../src/audio-assets';
import { configFromEnv, contentType, IMMUTABLE, objectUrl, uploadAudio, type UploadConfig } from '../src/audio-upload';
import { buildPacks } from '../src/build-packs';
import { signV4 } from '../src/sigv4';
import { exercises, makeFixture, writeUnit, type Fixture } from './fixture';

let f: Fixture;
beforeEach(() => { f = makeFixture(); });
afterEach(() => f.cleanup());

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cfg: UploadConfig = {
  bucket: 'dp-audio', endpoint: 'https://acc.r2.cloudflarestorage.com', accessKeyId: 'AKID', secretAccessKey: 'SECRET',
  publicBase: 'https://audio.example.org/', region: 'auto',
};

/** A unit with a recorded dictation (mp3 + opus) and a drill with one recorded word. */
function recorded() {
  writeUnit(f, 'A1', 1, {
    exercises: exercises('a1-u1').map((e) => (e.id === 'a1-u1-dict' ? { ...e, audio: 'audio/ex-a1-u1-dict.mp3' } : e)),
  });
  const dir = join(f.content, 'a1', 'unit-01', 'audio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ex-a1-u1-dict.mp3'), 'MP3DATA');
  writeFileSync(join(dir, 'ex-a1-u1-dict.opus'), 'OPUSDATA');
  writeFileSync(join(dir, 'unreferenced.mp3'), 'nope');
  f.write('pronunciation/ue-u.yaml', {
    id: 'ue-u', title: 'ü vs u', explanation: 'Round your lips.',
    pairs: [[{ text: 'Mütter', en: 'mothers' }, { text: 'Mutter', en: 'mother' }]],
    words: [{ text: 'Tür', en: 'door', audio: 'audio/pron-ue-u-word-01.mp3' }],
  });
  mkdirSync(join(f.content, 'pronunciation', 'ue-u', 'audio'), { recursive: true });
  writeFileSync(join(f.content, 'pronunciation', 'ue-u', 'audio', 'pron-ue-u-word-01.mp3'), 'TUER');
}

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
function fakeBucket(initial: Record<string, string> = {}, fail?: (c: Call) => number | undefined) {
  const store = new Map<string, { body: string; meta?: string; headers: Record<string, string> }>();
  for (const [k, v] of Object.entries(initial)) store.set(k, { body: v, meta: sha(v), headers: {} });
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const body = init.body ? Buffer.from(init.body as Uint8Array).toString() : undefined;
    const call: Call = { method: init.method!, url, headers, ...(body !== undefined ? { body } : {}) };
    calls.push(call);
    const status = fail?.(call);
    if (status) return new Response('<Error>nope</Error>', { status });
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\/dp-audio\//, ''));
    if (init.method === 'HEAD') {
      const o = store.get(key);
      return o ? new Response(null, { status: 200, headers: o.meta ? { 'x-amz-meta-sha256': o.meta } : {} }) : new Response(null, { status: 404 });
    }
    store.set(key, { body: body!, meta: headers['x-amz-meta-sha256'], headers });
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;
  return { store, calls, fetchImpl };
}

describe('audio layout', () => {
  it('hashes mp3 + opus together and builds public URLs', () => {
    expect(hashedName('a1/a1-u01/audio/x.mp3', 'abc')).toBe('a1/a1-u01/audio/x.abc.mp3');
    expect(publicUrl('https://cdn.example/', 'a1/x y.mp3')).toBe('https://cdn.example/a1/x%20y.mp3');
    recorded();
    const { objects, urls } = cdnLayout(
      [{ owner: 'a1/a1-u01', path: 'audio/ex-a1-u1-dict.mp3', files: [
        { src: join(f.content, 'a1/unit-01/audio/ex-a1-u1-dict.mp3'), rel: 'a1/a1-u01/audio/ex-a1-u1-dict.mp3' },
        { src: join(f.content, 'a1/unit-01/audio/ex-a1-u1-dict.opus'), rel: 'a1/a1-u01/audio/ex-a1-u1-dict.opus' },
      ] }],
      'https://cdn.example',
    );
    const h = objects[0]!.key.split('.')[1]!;
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(objects.map((o) => o.key)).toEqual([`a1/a1-u01/audio/ex-a1-u1-dict.${h}.mp3`, `a1/a1-u01/audio/ex-a1-u1-dict.${h}.opus`]);
    expect(urls.get('a1/a1-u01|audio/ex-a1-u1-dict.mp3')).toBe(`https://cdn.example/a1/a1-u01/audio/ex-a1-u1-dict.${h}.mp3`);
    expect(groupHash({ owner: '', path: '', files: [{ src: 'x', rel: 'a.mp3' }] }, () => Buffer.from('1')))
      .not.toBe(groupHash({ owner: '', path: '', files: [{ src: 'x', rel: 'a.mp3' }] }, () => Buffer.from('2')));
  });
  it('reads the config from the environment and builds object URLs', () => {
    expect(configFromEnv({}).missing).toEqual(['AUDIO_BUCKET', 'AUDIO_ENDPOINT', 'AUDIO_ACCESS_KEY_ID', 'AUDIO_SECRET_ACCESS_KEY', 'AUDIO_PUBLIC_BASE']);
    const env = { AUDIO_BUCKET: 'b', AUDIO_ENDPOINT: 'https://e.example/', AUDIO_ACCESS_KEY_ID: 'k', AUDIO_SECRET_ACCESS_KEY: 's', AUDIO_PUBLIC_BASE: 'https://cdn' };
    expect(configFromEnv(env).config).toEqual({ bucket: 'b', endpoint: 'https://e.example', accessKeyId: 'k', secretAccessKey: 's', publicBase: 'https://cdn', region: 'auto' });
    expect(configFromEnv({ ...env, AUDIO_REGION: 'eu-central-1' }).config!.region).toBe('eu-central-1');
    expect(objectUrl(cfg, 'a1/a1-u01/audio/x.abc.mp3')).toBe('https://acc.r2.cloudflarestorage.com/dp-audio/a1/a1-u01/audio/x.abc.mp3');
    expect(objectUrl({ bucket: 'b', endpoint: 'https://{bucket}.s3.eu-central-1.amazonaws.com' }, 'a/ü.mp3')).toBe('https://b.s3.eu-central-1.amazonaws.com/a/%C3%BC.mp3');
    expect(contentType('x.mp3')).toBe('audio/mpeg');
    expect(contentType('x.opus')).toBe('audio/ogg; codecs=opus');
  });
});

describe('audio:upload', () => {
  it('is a dry run without config and lists the referenced files only', async () => {
    recorded();
    const { calls, fetchImpl } = fakeBucket();
    const r = await uploadAudio({ contentDir: f.content, root: f.root, fetch: fetchImpl });
    expect(r.dryRun).toBe(true);
    expect(calls).toEqual([]);
    expect(r.objects.map((o) => o.key.replace(/\.[0-9a-f]{12}\./, '.#.'))).toEqual([
      'a1/a1-u01/audio/ex-a1-u1-dict.#.mp3', 'a1/a1-u01/audio/ex-a1-u1-dict.#.opus', 'pronunciation/ue-u/audio/pron-ue-u-word-01.#.mp3',
    ]);
    expect(r.log).toMatch(/dry run: 3 file\(s\)/);
    expect((await uploadAudio({ contentDir: f.content, root: f.root, fetch: fetchImpl, config: cfg, dryRun: true })).dryRun).toBe(true);
    expect(calls).toEqual([]);
  });
  it('uploads with signed PUTs, then skips unchanged objects by x-amz-meta-sha256', async () => {
    recorded();
    const bucket = fakeBucket();
    const now = () => new Date('2026-10-25T12:00:00Z');
    const r = await uploadAudio({ contentDir: f.content, root: f.root, fetch: bucket.fetchImpl, config: cfg, now });
    expect(r.ok).toBe(true);
    expect(r.uploaded).toHaveLength(3);
    const puts = bucket.calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(3);
    const mp3 = puts.find((c) => c.url.endsWith('.mp3') && c.url.includes('dict'))!;
    expect(mp3.url).toMatch(/^https:\/\/acc\.r2\.cloudflarestorage\.com\/dp-audio\/a1\/a1-u01\/audio\/ex-a1-u1-dict\.[0-9a-f]{12}\.mp3$/);
    expect(mp3.body).toBe('MP3DATA');
    expect(mp3.headers).toMatchObject({
      'content-type': 'audio/mpeg', 'cache-control': IMMUTABLE, 'x-amz-meta-sha256': sha('MP3DATA'),
      'x-amz-content-sha256': sha('MP3DATA'), 'x-amz-date': '20261025T120000Z',
    });
    expect(mp3.headers.host).toBeUndefined();
    // The Authorization header is the SigV4 signature of exactly this request.
    const expected = signV4({
      method: 'PUT', url: mp3.url, region: 'auto', service: 's3', accessKeyId: 'AKID', secretAccessKey: 'SECRET', date: now(),
      headers: { 'content-type': 'audio/mpeg', 'cache-control': IMMUTABLE, 'x-amz-meta-sha256': sha('MP3DATA'), 'x-amz-content-sha256': sha('MP3DATA') },
      payloadHash: sha('MP3DATA'),
    });
    expect(mp3.headers.authorization).toBe(expected.headers.authorization);
    expect(mp3.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261025\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256, Signature=[0-9a-f]{64}$/);
    expect(bucket.calls.find((c) => c.method === 'HEAD')!.headers['x-amz-content-sha256']).toBe(sha(''));

    bucket.calls.length = 0;
    const again = await uploadAudio({ contentDir: f.content, root: f.root, fetch: bucket.fetchImpl, config: cfg, now });
    expect(again.uploaded).toEqual([]);
    expect(again.skipped).toHaveLength(3);
    expect(bucket.calls.every((c) => c.method === 'HEAD')).toBe(true);

    // A changed recording gets a new hashed name and is uploaded; the old object stays.
    writeFileSync(join(f.content, 'a1', 'unit-01', 'audio', 'ex-a1-u1-dict.mp3'), 'NEWTAKE');
    const changed = await uploadAudio({ contentDir: f.content, root: f.root, fetch: bucket.fetchImpl, config: cfg, now });
    expect(changed.uploaded).toHaveLength(2);
    expect(changed.skipped).toEqual(['pronunciation/ue-u/audio/pron-ue-u-word-01.' + changed.skipped[0]!.split('.')[1] + '.mp3']);
    expect(bucket.store.size).toBe(5);
  });
  it('re-uploads when the stored hash differs and reports failures', async () => {
    recorded();
    const first = await uploadAudio({ contentDir: f.content, root: f.root, config: cfg, dryRun: true });
    const key = first.objects[0]!.key;
    const bucket = fakeBucket({ [key]: 'CORRUPT' }, (c) => (c.method === 'PUT' && c.url.endsWith('.opus') ? 500 : undefined));
    const r = await uploadAudio({ contentDir: f.content, root: f.root, fetch: bucket.fetchImpl, config: cfg });
    expect(r.ok).toBe(false);
    expect(r.uploaded).toContain(key);
    expect(bucket.store.get(key)!.body).toBe('MP3DATA');
    expect(r.failed).toEqual([first.objects[1]!.key]);
    expect(r.log).toMatch(/error .*\.opus: PUT returned 500: <Error>nope<\/Error>/);
  });
});

describe('content:build with AUDIO_PUBLIC_BASE', () => {
  it('rewrites audio fields to hashed CDN URLs and copies nothing', () => {
    recorded();
    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.4.0', root: f.root, audioBase: 'https://audio.example.org/' });
    expect(r.ok).toBe(true);
    expect(r.audio).toEqual([]);
    expect(existsSync(join(f.out, 'audio'))).toBe(false);
    const pack = LevelPack.parse(JSON.parse(readFileSync(join(f.out, 'a1.json'), 'utf8')));
    const dict = pack.units[0]!.exercises.find((e) => e.id === 'a1-u1-dict')!;
    expect(dict.audio).toMatch(/^https:\/\/audio\.example\.org\/a1\/a1-u01\/audio\/ex-a1-u1-dict\.[0-9a-f]{12}\.mp3$/);
    const pron = PronunciationPack.parse(JSON.parse(readFileSync(join(f.out, 'pronunciation.json'), 'utf8')));
    expect(pron.drills[0]!.words[0]!.audio).toMatch(/^https:\/\/audio\.example\.org\/pronunciation\/ue-u\/audio\/pron-ue-u-word-01\.[0-9a-f]{12}\.mp3$/);
    expect(r.log).toMatch(/audio: 2 reference\(s\) point to https:\/\/audio\.example\.org\/ \(3 file\(s\)/);
  });
  it('uses the same keys as audio:upload', async () => {
    recorded();
    buildPacks({ contentDir: f.content, outDir: f.out, version: '0.4.0', root: f.root, audioBase: 'https://cdn.example' });
    const pack = JSON.parse(readFileSync(join(f.out, 'a1.json'), 'utf8')) as LevelPack;
    const url = pack.units[0]!.exercises.find((e) => e.id === 'a1-u1-dict')!.audio!;
    const up = await uploadAudio({ contentDir: f.content, root: f.root, dryRun: true });
    expect(up.objects.map((o) => `https://cdn.example/${o.key}`)).toContain(url);
  });
  it('copies into packs/audio without a base, as before', () => {
    recorded();
    mkdirSync(join(f.out, 'audio', 'stale'), { recursive: true });
    const r = buildPacks({ contentDir: f.content, outDir: f.out, version: '0.4.0', root: f.root });
    expect(r.audio).toEqual([
      'audio/a1/a1-u01/audio/ex-a1-u1-dict.mp3', 'audio/a1/a1-u01/audio/ex-a1-u1-dict.opus', 'audio/pronunciation/ue-u/audio/pron-ue-u-word-01.mp3',
    ]);
    expect(existsSync(join(f.out, 'audio', 'stale'))).toBe(false);
    const pack = JSON.parse(readFileSync(join(f.out, 'a1.json'), 'utf8')) as LevelPack;
    expect(pack.units[0]!.exercises.find((e) => e.id === 'a1-u1-dict')!.audio).toBe('audio/ex-a1-u1-dict.mp3');
  });
});
