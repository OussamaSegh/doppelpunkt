/**
 * Server-side scrubbing. The app already scrubs crash reports on the device; the collector does it
 * again so that a buggy or old client can't put personal data into storage.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
/** Any URL that carries a query string or fragment (tokens, ids and search terms live there). */
const URL_WITH_QUERY = /\b(?:https?|wss?|blob|file):\/\/[^\s"'<>()]*[?#][^\s"'<>()]*/gi;
/**
 * Seven or more digits, optionally separated by single spaces, dots, dashes, apostrophes or slashes
 * (phone, card, account and customer numbers). Not after ":" so that stack line:column numbers
 * survive, and not inside words so that bundle hashes survive.
 */
const LONG_DIGITS = /(?<![\w:.\-])\+?\d(?:[ .\-'/]?\d){6,}(?!\w)/g;

export function scrub(text: string): string {
  return text.replace(EMAIL, '[email]').replace(URL_WITH_QUERY, '[url]').replace(LONG_DIGITS, '[number]');
}

export function scrubOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : scrub(text);
}

/** Routes are app paths; drop any query string or fragment and scrub the rest. */
export function scrubRoute(route: string): string {
  return scrub(route.replace(/[?#].*$/s, ''));
}
