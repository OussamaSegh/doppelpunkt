#!/usr/bin/env node
// Performance budget: the JavaScript the browser loads before the first screen can render
// (the entry module plus everything index.html modulepreloads, i.e. its static imports) must
// stay under 200 KB gzip. Lazy screens (React.lazy) don't count. Run after `vite build`:
//   node scripts/check-budget.mjs [--budget 200] [--dist dist]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', opt('dist', 'dist'));
const budgetKb = Number(opt('budget', '200'));

const indexHtml = join(dist, 'index.html');
if (!existsSync(indexHtml)) {
  console.error(`check-budget: ${indexHtml} not found. Run "vite build" first.`);
  process.exit(2);
}
const html = readFileSync(indexHtml, 'utf8');
const refs = new Set();
for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]+rel="modulepreload"/g)) refs.add(m[1]);

const base = (p) => p.replace(/^\.?\//, '').replace(/^.*?assets\//, 'assets/');
const kb = (n) => (n / 1024).toFixed(1);
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

// Follow static imports inside the chunks too (in case a chunk isn't modulepreloaded).
const queue = [...refs].map(base);
const initial = new Set();
while (queue.length) {
  const rel = queue.shift();
  if (initial.has(rel)) continue;
  const file = join(dist, rel);
  if (!existsSync(file)) continue;
  initial.add(rel);
  const src = readFileSync(file, 'utf8');
  // Static `import … from "./x.js"` and bare `import "./x.js"` — not dynamic import().
  for (const m of src.matchAll(/(?:^|[;\n}])\s*import\s*(?:[\w*{}\s,$]+from\s*)?["']\.\/([^"']+\.js)["']/g)) {
    queue.push(join(dirname(rel), m[1]).replace(/\\/g, '/'));
  }
}

const rows = [...initial].map((rel) => ({ rel, raw: readFileSync(join(dist, rel)).length, gzip: gz(join(dist, rel)) })).sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((a, r) => a + r.gzip, 0);
const lazy = readdirSync(join(dist, 'assets'))
  .filter((f) => f.endsWith('.js') && !initial.has(`assets/${f}`))
  .map((f) => ({ f, gzip: gz(join(dist, 'assets', f)) }))
  .sort((a, b) => b.gzip - a.gzip);

console.log('Initial JS (entry + static imports):');
for (const r of rows) console.log(`  ${r.rel.padEnd(40)} ${kb(r.raw).padStart(8)} KB  ${kb(r.gzip).padStart(7)} KB gzip`);
console.log(`  ${'total'.padEnd(40)} ${''.padStart(8)}     ${kb(total).padStart(7)} KB gzip (budget ${budgetKb} KB)`);
console.log(`Lazy chunks: ${lazy.length}, largest ${lazy.slice(0, 5).map((l) => `${l.f} ${kb(l.gzip)} KB`).join(', ')}`);

if (total > budgetKb * 1024) {
  console.error(`check-budget: initial JS is ${kb(total)} KB gzip, over the ${budgetKb} KB budget.`);
  process.exit(1);
}
console.log('check-budget: OK');
