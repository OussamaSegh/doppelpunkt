// On-device scrubbing for crash reports: nothing that could identify the learner or unlock an
// account leaves the device. Applied to error names, messages, stacks and routes.

// Provider keys: Anthropic (sk-ant-), OpenAI (sk-, sk-proj-), xAI (xai-), Google (AIza…).
const PROVIDER_KEYS = /sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{6,}|xai-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,}/g;
// "Bearer …" / "Basic …" credentials.
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
// "x-api-key: …", "apiKey=…", "password: …": keep the name, drop the value.
const NAMED_SECRET = /\b(x-api-key|x-goog-api-key|api[_-]?key|authorization|access[_-]?token|token|secret|passphrase|password)(["']?\s*[:=]\s*["']?)[^\s"',;&)]+/gi;
// Anything long and key-like: 32+ letters, digits, _ or - (hex ids, JWT parts, tokens).
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?|wss?|blob|file|chrome-extension|moz-extension):\/\/?[^\s"'<>()]*/gi;
const LONG_DIGITS = /\d{5,}/g;

function scrubKeys(s: string): string {
  return s
    .replace(PROVIDER_KEYS, '[key]')
    .replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} [key]`)
    .replace(NAMED_SECRET, (_m, name: string, sep: string) => `${name}${sep}[key]`)
    .replace(LONG_TOKEN, '[key]');
}

/** URL → its origin only ("https://example.com/a?b" → "https://example.com"). */
export function urlToOrigin(url: string): string {
  try {
    const u = new URL(url);
    if (u.origin && u.origin !== 'null') return u.origin;
    return `${u.protocol}//`;
  } catch {
    return '[url]';
  }
}

/** Last path segment of a URL, keeping ":line:col" (for stack frames). */
function urlToFile(url: string): string {
  const m = /^(.*?)((?::\d+){0,2})$/.exec(url);
  const base = (m?.[1] ?? url).replace(/[?#].*$/, '');
  const parts = base.split('/').filter(Boolean);
  // A bare origin ("https://host") has no file name.
  const name = parts.length > 2 ? parts[parts.length - 1]! : '[file]';
  return `${name}${m?.[2] ?? ''}`;
}

/** Scrubs free text: emails, URLs (origin only), API keys and runs of 5 or more digits. */
export function scrubText(input: unknown, max = 500): string {
  let s = typeof input === 'string' ? input : String(input ?? '');
  s = s.replace(EMAIL, '[email]');
  s = s.replace(URL_RE, (u) => urlToOrigin(u));
  s = scrubKeys(s);
  s = s.replace(LONG_DIGITS, '[n]');
  return s.slice(0, max);
}

/**
 * Scrubs a stack trace: file URLs become bundle file names with line and column
 * ("https://app/assets/index-abc.js:1:23456" → "index-abc.js:1:23456"); everything else as scrubText.
 */
export function scrubStack(stack: unknown, max = 4000): string {
  let s = typeof stack === 'string' ? stack : '';
  s = s.replace(EMAIL, '[email]');
  // Collect file references so the digit scrub keeps line/column numbers.
  const files: string[] = [];
  s = s.replace(URL_RE, (u) => {
    files.push(urlToFile(u));
    return `\u0000${files.length - 1}\u0000`;
  });
  s = scrubKeys(s);
  s = s.replace(LONG_DIGITS, '[n]');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => scrubKeys(files[Number(i)] ?? '[file]'));
  return s
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(0, 40)
    .join('\n')
    .slice(0, max);
}

/** Route without query or hash, with ids that look personal scrubbed. */
export function scrubRoute(pathname: string): string {
  return scrubText(pathname.split(/[?#]/)[0] ?? '/', 100) || '/';
}

/** Browser family and major version only, e.g. "Chrome 131" or "Safari 18 (iOS)". */
export function browserName(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? ' (iOS)' : /Android/.test(ua) ? ' (Android)' : '';
  const tests: Array<[string, RegExp]> = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Opera', /OPR\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ];
  for (const [name, re] of tests) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}${os}`.slice(0, 60);
  }
  return `Other${os}`.slice(0, 60);
}
