// AWS Signature Version 4 request signing with node:crypto only (no SDK). Works for Amazon S3
// and S3-compatible stores such as Cloudflare R2 (region "auto"). See
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
import { createHash, createHmac } from 'node:crypto';

export type SignInput = {
  method: string;
  url: string;
  /** Request headers to sign (any case). host and x-amz-date are added when missing. */
  headers?: Record<string, string>;
  /** Hex sha256 of the body; defaults to the hash of an empty body. */
  payloadHash?: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  date?: Date;
};

export type Signed = {
  /** Headers to send, lower-case names, including host, x-amz-date and authorization. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
};

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();

/** RFC 3986 encoding as SigV4 wants it: everything except A-Z a-z 0-9 - . _ ~ is %XX (upper case). */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 20150830T123600Z */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function canonicalPath(pathname: string): string {
  // Encode each segment once (S3 style): decode what URL() already encoded, then encode strictly.
  const segs = pathname.split('/').map((seg) => {
    let raw = seg;
    try {
      raw = decodeURIComponent(seg);
    } catch {
      /* keep as is */
    }
    return uriEncode(raw);
  });
  const p = segs.join('/');
  return p.startsWith('/') ? p : `/${p}`;
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

/** Sign a request. Pure: the same input (including `date`) gives the same signature. */
export function signV4(input: SignInput): Signed {
  const url = new URL(input.url);
  const date = input.date ?? new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host ??= url.host;
  headers['x-amz-date'] ??= stamp;
  if (input.sessionToken) headers['x-amz-security-token'] ??= input.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const payloadHash = input.payloadHash ?? EMPTY_SHA256;
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', headers['x-amz-date'], scope, sha256(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretAccessKey, day, input.region, input.service)).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
