// Renders public/icons/*.svg to the PNG sizes the manifest needs.
// Usage: node apps/web/scripts/make-icons.mjs  (uses the preinstalled Playwright Chromium)
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const jobs = [
  ['logo.svg', 'icon-192.png', 192],
  ['logo.svg', 'icon-512.png', 512],
  ['logo.svg', 'apple-touch-icon.png', 180],
  ['maskable.svg', 'maskable-512.png', 512],
];

const browser = await chromium.launch();
try {
  for (const [src, out, size] of jobs) {
    const svg = await readFile(dir + src, 'utf8');
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await page.screenshot({ path: dir + out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log('wrote', out);
  }
} finally {
  await browser.close();
}
