import { a1Pack, expect, onboard, test, unit1 } from './fixtures';

type Manifest = {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  icons?: Array<{ src: string; sizes?: string; type?: string; purpose?: string }>;
};

test('the web app manifest is installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href, 'index.html links a manifest').toBeTruthy();

  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as Manifest;
  expect(manifest.name).toBe('Doppelpunkt');
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBeTruthy();
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);

  const icons = manifest.icons ?? [];
  for (const size of ['192x192', '512x512']) {
    const icon = icons.find((i) => i.sizes === size && i.type === 'image/png');
    expect(icon, `a ${size} PNG icon`).toBeTruthy();
    const img = await request.get(new URL(icon!.src, res.url()).toString());
    expect(img.ok(), `${icon!.src} is served`).toBe(true);
    expect(img.headers()['content-type']).toContain('image/png');
  }
  expect(icons.some((i) => i.purpose?.includes('maskable')), 'a maskable icon').toBe(true);

  // iOS uses the apple-touch-icon instead of the manifest icons.
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(new URL(apple!, page.url()).toString())).ok()).toBe(true);
});

test.describe('offline', () => {
  // Requests that fail while offline (e.g. the pack revalidation) may log network errors.
  test.use({ allowConsole: [/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR_/] });

  test('after the first visit the app shell and the A1 pack load without a network', async ({ page, context }) => {
    const unit = unit1();
    await onboard(page);

    // Wait for the service worker to install, activate and take control of this page.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
      }
    });
    // The first visit's pack request may happen before the worker controls the page; the app re-warms it.
    await expect
      .poll(async () => page.evaluate(async () => (await caches.keys()).length > 0 && !!(await caches.match(new URL('packs/a1.json', location.origin + '/').href))), {
        message: 'A1 pack is in the offline cache',
        timeout: 15_000,
      })
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('list', { name: 'A1 units' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'A1 units' }).getByRole('listitem')).toHaveCount(a1Pack().units.length);

    // Deep links work offline too (navigation fallback to the cached index.html).
    await page.goto(`/unit/${unit.id}/uebungen`);
    await expect(page.getByRole('heading', { level: 1, name: unit.title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check' })).toBeVisible();
    await context.setOffline(false);
  });
});
