import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/** Workspace packages are consumed as TypeScript source (no build step). */
export const workspaceAliases = {
  '@doppelpunkt/content-schema': pkg('content-schema'),
  '@doppelpunkt/engine': pkg('engine'),
  '@doppelpunkt/ai': pkg('ai'),
};

export default defineConfig({
  resolve: { alias: workspaceAliases },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'dexie';
          return 'vendor';
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/logo.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Doppelpunkt',
        short_name: 'Doppelpunkt',
        description: 'Learn Standard German and Swiss German, A1 to C2.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#1c2a4a',
        background_color: '#fbf8f1',
        categories: ['education'],
        icons: [
          { src: 'icons/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only; content packs and audio are cached at runtime.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['packs/**'],
        // Take control of the page on first install, so the first visit's requests are cached too.
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/packs\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/packs/') && url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'dp-packs', expiration: { maxEntries: 40 } },
          },
          {
            urlPattern: ({ request, url }) =>
              request.destination === 'audio' || /\.(mp3|m4a|ogg|opus|wav|webm)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dp-audio',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
});
