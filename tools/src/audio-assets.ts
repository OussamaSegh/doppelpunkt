// The processed audio files that the packs reference, with where they are published.
// Shared by content:build (copy into public/packs/audio, or rewrite to the CDN) and audio:upload.
//
// Layout under packs/audio/ (and under the bucket root on the CDN):
//   units:  <level>/<unit id>/<path>             e.g. a1/a1-u01/audio/dialog-intro-01.mp3
//   exams:  <level>/<exam id>/<path>             e.g. a1/a1-modelltest-1/audio/stimulus-hoeren.mp3
//   drills: pronunciation/<drill id>/<path>      e.g. pronunciation/ue-u/audio/pron-ue-u-word-01.mp3
// <path> is the YAML `audio:` value. Each referenced file comes with its .opus sibling when present.
// On the CDN every file gets a content-hashed name (dialog-intro-01.<hash>.mp3, same hash for the
// .mp3 and the .opus) so it can be cached forever.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, posix } from 'node:path';
import { audioRefs, isRemote } from './audio';
import { examAudioRefs, type LoadedExam } from './exam';
import type { LoadedUnit } from './load';
import { drillItems, PRONUNCIATION_DIR, type LoadedDrill } from './pronunciation';

export type AudioFile = {
  /** Absolute source file. */
  src: string;
  /** Path under packs/audio/ (and the plain bucket key), e.g. a1/a1-u01/audio/x.mp3. */
  rel: string;
};

export type AudioGroup = {
  /** Folder under packs/audio/ the YAML path is relative to, e.g. a1/a1-u01. */
  owner: string;
  /** The YAML path, normalised to forward slashes, e.g. audio/x.mp3. */
  path: string;
  /** The referenced file first, then the .opus sibling when it exists and differs. */
  files: AudioFile[];
};

/** Relative, inside-the-folder paths only (no URLs, no ..). */
function localPath(p: string): string | undefined {
  if (isRemote(p)) return undefined;
  const rel = normalize(p).split('\\').join('/');
  return rel.startsWith('..') ? undefined : rel;
}

/** Every referenced audio file that exists, grouped by YAML reference, sorted and de-duplicated. */
export function audioGroups(units: LoadedUnit[], drills: LoadedDrill[], exams: LoadedExam[] = []): AudioGroup[] {
  const groups = new Map<string, AudioGroup>();
  const add = (dir: string, owner: string, p: string) => {
    const path = localPath(p);
    if (!path) return;
    const id = `${owner}|${path}`;
    if (groups.has(id)) return;
    const files: AudioFile[] = [];
    for (const v of new Set([path, path.replace(/\.[a-z0-9]+$/i, '.opus')])) {
      const src = join(dir, v);
      if (existsSync(src)) files.push({ src, rel: posix.join(owner, v) });
    }
    if (files.length && files[0]!.rel === posix.join(owner, path)) groups.set(id, { owner, path, files });
  };
  for (const lu of units) for (const r of audioRefs(lu.unit)) add(lu.dir, `${lu.level.toLowerCase()}/${lu.unit.id}`, r.path);
  for (const le of exams) for (const r of examAudioRefs(le.exam)) add(le.dir, `${le.level.toLowerCase()}/${le.exam.id}`, r.path);
  for (const ld of drills) {
    for (const { item } of drillItems(ld.drill)) if (item.audio) add(ld.dir, `${PRONUNCIATION_DIR}/${ld.drill.id}`, item.audio);
  }
  return [...groups.values()].sort((a, b) => (a.owner + a.path).localeCompare(b.owner + b.path));
}

export const sha256Hex = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Length of the content hash in CDN file names. */
export const HASH_LENGTH = 12;

/** Hash shared by the files of a group: sha256 over the sha256 of each file, in order. */
export function groupHash(g: AudioGroup, read: (p: string) => Buffer = readFileSync): string {
  return sha256Hex(g.files.map((f) => `${f.rel.split('.').pop()}:${sha256Hex(read(f.src))}`).join('\n')).slice(0, HASH_LENGTH);
}

/** a1/a1-u01/audio/x.mp3 + hash -> a1/a1-u01/audio/x.<hash>.mp3 */
export function hashedName(rel: string, hash: string): string {
  const m = /^(.*?)(\.[a-z0-9]+)$/i.exec(rel);
  return m ? `${m[1]}.${hash}${m[2]}` : `${rel}.${hash}`;
}

/** Join a public base URL and a key with exactly one slash; key segments are URL-encoded. */
export function publicUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export type AudioKeyMap = Map<string, string>;
/** Lookup key for a reference: owner folder + YAML path. */
export const refKey = (owner: string, path: string) => `${owner}|${localPath(path) ?? path}`;

/**
 * Bucket keys per group (hashed by default) and the URL each YAML reference maps to.
 * `urls` maps refKey(owner, path) to the public URL of the referenced file.
 */
export function cdnLayout(groups: AudioGroup[], base: string, opts: { hashed?: boolean; read?: (p: string) => Buffer } = {}) {
  const hashed = opts.hashed ?? true;
  const urls: AudioKeyMap = new Map();
  const objects: Array<AudioFile & { key: string; hashed: boolean }> = [];
  for (const g of groups) {
    const hash = hashed ? groupHash(g, opts.read) : '';
    for (const f of g.files) objects.push({ ...f, key: hashed ? hashedName(f.rel, hash) : f.rel, hashed });
    urls.set(refKey(g.owner, g.path), publicUrl(base, objects[objects.length - g.files.length]!.key));
  }
  return { objects, urls };
}
