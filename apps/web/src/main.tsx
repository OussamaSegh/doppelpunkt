import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { warmPackCache } from './content';
import { startBeta } from './lib/beta/boot';
import './index.css';

registerSW({ immediate: true });
// Beta builds only (VITE_COLLECTOR_URL set): crash handlers and the outbox sync. Sends nothing without opt-in.
startBeta();

// First visit: once the new service worker takes control, fetch the packs again through it so
// they are cached for offline use.
if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => void warmPackCache(), { once: true });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing in index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
