// `npm run audio:upload [-- --dry-run] [--concurrency 4]`: uploads the processed audio that the
// packs reference (mp3 + opus, from content/**) to an S3-compatible bucket (Cloudflare R2, Amazon
// S3, ...) under content-hashed names, so `content:build` with AUDIO_PUBLIC_BASE can point the
// packs at the CDN. Node built-ins only: requests are signed with AWS SigV4 (sigv4.ts).
//
// Environment:
//   AUDIO_BUCKET             bucket name
//   AUDIO_ENDPOINT           S3 API endpoint, e.g. https://<account id>.r2.cloudflarestorage.com or
//                            https://s3.eu-central-1.amazonaws.com (path-style). Use {bucket} for a
//                            virtual-hosted endpoint: https://{bucket}.s3.eu-central-1.amazonaws.com
//   AUDIO_ACCESS_KEY_ID      access key (R2: an API token with Object Read & Write on the bucket)
//   AUDIO_SECRET_ACCESS_KEY  secret key
//   AUDIO_PUBLIC_BASE        public URL of the bucket root, e.g. https://audio.example.org
//   AUDIO_REGION             optional; default "auto" (R2). Use the bucket's region for S3.
// Without all of the first five the command runs as a dry run and exits 0.
//
// Each object is stored with x-amz-meta-sha256 (sha256 of the file). Before uploading, a HEAD
// request checks it, and objects with the same hash are skipped. Names are content-hashed, so
// every object gets Cache-Control: public, max-age=31536000, immutable.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audioGroups, cdnLayout, sha256Hex } from './audio-assets';
import { loadExams } from './exam';
import { formatIssues, repoRoot } from './lint';
import { loadContent } from './load';
import { loadDrills } from './pronunciation';
import { EMPTY_SHA256, signV4, uriEncode } from './sigv4';

export type UploadConfig = {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
  region: string;
};

export const ENV_VARS = ['AUDIO_BUCKET', 'AUDIO_ENDPOINT', 'AUDIO_ACCESS_KEY_ID', 'AUDIO_SECRET_ACCESS_KEY', 'AUDIO_PUBLIC_BASE'] as const;
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Read the upload configuration from the environment; `missing` lists unset variables. */
export function configFromEnv(env: Record<string, string | undefined> = process.env): { config?: UploadConfig; missing: string[] } {
  const v = (k: string) => env[k]?.trim() || undefined;
  const missing = ENV_VARS.filter((k) => !v(k));
  if (missing.length) return { missing };
  return {
    missing: [],
    config: {
      bucket: v('AUDIO_BUCKET')!,
      endpoint: v('AUDIO_ENDPOINT')!.replace(/\/+$/, ''),
      accessKeyId: v('AUDIO_ACCESS_KEY_ID')!,
      secretAccessKey: v('AUDIO_SECRET_ACCESS_KEY')!,
      publicBase: v('AUDIO_PUBLIC_BASE')!,
      region: v('AUDIO_REGION') ?? 'auto',
    },
  };
}

/** S3 API URL of an object: virtual-hosted when the endpoint contains {bucket}, otherwise path-style. */
export function objectUrl(cfg: Pick<UploadConfig, 'bucket' | 'endpoint'>, key: string): string {
  const path = key.split('/').map(uriEncode).join('/');
  return cfg.endpoint.includes('{bucket}')
    ? `${cfg.endpoint.replace('{bucket}', cfg.bucket)}/${path}`
    : `${cfg.endpoint}/${uriEncode(cfg.bucket)}/${path}`;
}

export function contentType(key: string): string {
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.opus') || key.endsWith('.ogg')) return 'audio/ogg; codecs=opus';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.webm')) return 'audio/webm';
  return 'application/octet-stream';
}

export type UploadObject = { src: string; key: string; size: number };
export type UploadOptions = {
  contentDir: string;
  root?: string;
  /** Missing config means dry run. */
  config?: UploadConfig;
  dryRun?: boolean;
  fetch?: typeof fetch;
  concurrency?: number;
  now?: () => Date;
};
export type UploadResult = {
  ok: boolean;
  dryRun: boolean;
  objects: UploadObject[];
  uploaded: string[];
  skipped: string[];
  failed: string[];
  log: string;
};

/** The objects to upload: every referenced audio file and its .opus sibling, under its hashed key. */
export function uploadPlan(contentDir: string, root = process.cwd()): { objects: UploadObject[]; issues: string } {
  const loaded = loadContent(contentDir, root);
  const drills = loadDrills(contentDir, root);
  const exams = loadExams(contentDir, root);
  const errors = [...loaded.issues, ...drills.issues, ...exams.issues].filter((i) => i.severity === 'error');
  const { objects } = cdnLayout(audioGroups(loaded.units, drills.drills, exams.exams), '');
  return {
    objects: objects.map((o) => ({ src: o.src, key: o.key, size: statSync(o.src).size })),
    issues: errors.length ? `${formatIssues(errors)}\nUnits, drills and exams with errors are skipped.` : '',
  };
}

const kb = (n: number) => (n && n < 1024 ? '1 KB' : `${Math.round(n / 1024)} KB`);

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

export async function uploadAudio(opts: UploadOptions): Promise<UploadResult> {
  const root = opts.root ?? process.cwd();
  const plan = uploadPlan(opts.contentDir, root);
  const log: string[] = plan.issues ? [plan.issues] : [];
  const dryRun = Boolean(opts.dryRun || !opts.config);
  const res: UploadResult = { ok: true, dryRun, objects: plan.objects, uploaded: [], skipped: [], failed: [], log: '' };
  const total = plan.objects.reduce((n, o) => n + o.size, 0);

  if (dryRun) {
    for (const o of plan.objects) log.push(`would upload ${o.key} (${kb(o.size)})`);
    log.push(`dry run: ${plan.objects.length} file(s), ${kb(total)}; nothing was uploaded${opts.config ? '' : ' (set AUDIO_* to upload, see docs/DEPLOY.md)'}`);
    res.log = log.join('\n');
    return res;
  }

  const cfg = opts.config!;
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const send = (method: 'HEAD' | 'PUT', key: string, headers: Record<string, string> = {}, body?: Buffer, payloadHash = EMPTY_SHA256) => {
    const url = objectUrl(cfg, key);
    const signed = signV4({
      method, url, region: cfg.region, service: 's3', accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
      headers: { ...headers, 'x-amz-content-sha256': payloadHash }, payloadHash, date: now(),
    });
    // fetch sets Host from the URL (the same value that was signed).
    const { host: _host, ...send } = signed.headers;
    return doFetch(url, { method, headers: send, ...(body ? { body: new Uint8Array(body) } : {}) });
  };

  await pool(plan.objects, opts.concurrency ?? 4, async (o) => {
    try {
      const body = readFileSync(o.src);
      const sha = sha256Hex(body);
      const head = await send('HEAD', o.key);
      if (head.ok && head.headers.get('x-amz-meta-sha256') === sha) {
        res.skipped.push(o.key);
        return;
      }
      if (!head.ok && head.status !== 404 && head.status !== 403) {
        // 403 is what S3 returns for a missing key without ListBucket permission.
        throw new Error(`HEAD returned ${head.status}`);
      }
      const put = await send('PUT', o.key, {
        'content-type': contentType(o.key),
        'cache-control': IMMUTABLE,
        'x-amz-meta-sha256': sha,
      }, body, sha);
      if (!put.ok) {
        const text = (await put.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        throw new Error(`PUT returned ${put.status}${text ? `: ${text}` : ''}`);
      }
      res.uploaded.push(o.key);
      log.push(`uploaded ${o.key} (${kb(o.size)})`);
    } catch (err) {
      res.ok = false;
      res.failed.push(o.key);
      log.push(`error ${o.key}: ${(err as Error).message}`);
    }
  });
  res.uploaded.sort();
  res.skipped.sort();
  res.failed.sort();
  log.push(`${res.uploaded.length} uploaded, ${res.skipped.length} unchanged, ${res.failed.length} failed (bucket ${cfg.bucket}, public base ${cfg.publicBase})`);
  res.log = log.join('\n');
  return res;
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { config, missing } = configFromEnv();
  if (missing.length) console.log(`audio:upload: ${missing.join(', ')} not set; running as a dry run.`);
  const r = await uploadAudio({
    contentDir: resolve(argValue(argv, '--content') ?? join(repoRoot, 'content')),
    root: repoRoot,
    ...(config ? { config } : {}),
    dryRun: argv.includes('--dry-run'),
    concurrency: Number(argValue(argv, '--concurrency') ?? 4) || 4,
  });
  console.log(r.log);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; });
}
