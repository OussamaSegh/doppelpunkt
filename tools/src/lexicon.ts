// Schema and checks for the dialect lexicons in content/lexicon/*.yaml (part of `npm run content:lint`).
// The lexicon is reference data for authors and graders; it is not part of the content contract
// (packages/content-schema), so its light schema lives here. Field docs: the header of gsw-zh.yaml.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { readYaml, type Issue } from './load';

export const LEXICON_POS = ['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'phrase', 'other'] as const;

const text = z.string().trim().min(1, 'must not be empty');

export const LexiconEntry = z
  .object({
    de: text,
    gswZh: text,
    gswBe: text.optional(),
    chStd: text.optional(),
    en: text,
    pos: z.enum(LEXICON_POS).optional(),
    notes: text.optional(),
    tags: z.array(text).default([]),
  })
  .strict();
export type LexiconEntry = z.infer<typeof LexiconEntry>;

export const Lexicon = z.object({ entries: z.array(LexiconEntry).min(1, 'the lexicon needs at least one entry') }).strict();
export type Lexicon = z.infer<typeof Lexicon>;

export type LexiconResult = { files: number; entries: number; issues: Issue[] };

const label = (data: unknown, path: Array<string | number>) => {
  if (path[0] !== 'entries' || typeof path[1] !== 'number') return path.join('.') || '(root)';
  const e = (data as { entries?: unknown[] })?.entries?.[path[1]] as { de?: unknown } | undefined;
  const rest = path.slice(2).join('.');
  return `entries[${path[1]}]${e?.de ? ` (de: ${String(e.de)})` : ''}${rest ? ` .${rest}` : ''}`;
};

/** Validate every content/lexicon/*.yaml: YAML syntax, schema, and duplicate headwords (same de + pos). */
export function lintLexicons(contentDir: string, root = process.cwd()): LexiconResult {
  const dir = join(contentDir, 'lexicon');
  const issues: Issue[] = [];
  if (!existsSync(dir)) return { files: 0, entries: 0, issues };
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  let entries = 0;
  for (const name of files) {
    const path = join(dir, name);
    const rel = relative(root, path) || path;
    const y = readYaml(path, issues, root);
    if (!y.ok) continue;
    const parsed = Lexicon.safeParse(y.data);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) issues.push({ severity: 'error', file: rel, message: `${label(y.data, iss.path)}: ${iss.message}` });
      continue;
    }
    entries += parsed.data.entries.length;
    const seen = new Map<string, number>();
    parsed.data.entries.forEach((e, i) => {
      const key = `${e.de.toLowerCase()}|${e.pos ?? ''}`;
      const prev = seen.get(key);
      if (prev !== undefined) issues.push({ severity: 'error', file: rel, message: `entries[${i}] (de: ${e.de}): duplicate headword, same de and pos as entries[${prev}]` });
      else seen.set(key, i);
    });
  }
  return { files: files.length, entries, issues };
}
