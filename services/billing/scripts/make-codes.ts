/**
 * Generates book access codes for a print run.
 *
 *   HASH_SECRET=<same as the Worker secret> npm run codes -w @doppelpunkt/billing -- \
 *     --book B1 --count 1000 --max-uses 2 --batch 2026-10-print-1 [--out codes-out]
 *
 * Writes two files into --out (default services/billing/codes-out/, git-ignored):
 *   <batch>.codes.csv  the plaintext codes, formatted for printing. Hand them to the printer and
 *                      then delete or archive them offline: anyone with a code can redeem it.
 *   <batch>.sql        INSERT statements with only the HMAC of each code, for
 *                      npx wrangler d1 execute doppelpunkt-billing --remote --file <batch>.sql
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BOOKS, formatCode, generateCode } from '@doppelpunkt/license';
import { codeHash } from '../src/crypto';

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const book = opt('book', 'B1')!;
const count = Number(opt('count', '100'));
const maxUses = Number(opt('max-uses', '2'));
const batch = opt('batch');
const out = resolve(opt('out', join(import.meta.dirname, '..', 'codes-out'))!);
const secret = process.env.HASH_SECRET;

if (!BOOKS[book]) fail(`unknown --book ${book}; known: ${Object.keys(BOOKS).join(', ')}`);
if (!Number.isInteger(count) || count < 1 || count > 100_000) fail('--count must be 1..100000');
if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) fail('--max-uses must be 1..100');
if (!batch || !/^[\w.-]{1,64}$/.test(batch)) fail('--batch is required (letters, digits, . _ -)');
if (!secret) fail('set HASH_SECRET to the same value as the Worker secret');

function fail(msg: string): never {
  console.error(`make-codes: ${msg}`);
  process.exit(1);
}

const codes = new Set<string>();
while (codes.size < count) codes.add(generateCode(book));

const now = Date.now();
const rows: string[] = [];
for (const code of codes) {
  const hash = await codeHash(secret, code);
  rows.push(`INSERT INTO book_codes (hash, book, max_uses, uses, batch, revoked, created_at) VALUES ('${hash}', '${book}', ${maxUses}, 0, '${batch}', 0, ${now});`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${batch}.codes.csv`), `code\n${[...codes].map(formatCode).join('\n')}\n`, { mode: 0o600 });
writeFileSync(join(out, `${batch}.sql`), `${rows.join('\n')}\n`);
console.log(`make-codes: ${count} codes for ${book} (${BOOKS[book]}), ${maxUses} use(s) each, batch ${batch}`);
console.log(`  ${join(out, `${batch}.codes.csv`)}  (plaintext, keep private)`);
console.log(`  ${join(out, `${batch}.sql`)}        npx wrangler d1 execute doppelpunkt-billing --remote --file <this file>`);
