import type { ThemePref } from '../db';

const STORAGE_KEY = 'dp-theme';
const media = (): MediaQueryList | undefined =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return media()?.matches ? 'dark' : 'light';
}

/** Sets data-theme on <html>; mirrors the preference to localStorage so index.html can apply it before paint. */
export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
}

/** Re-applies the theme when the OS preference changes. Returns an unsubscribe function. */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const m = media();
  if (!m) return () => undefined;
  const onChange = () => {
    if (getPref() === 'system') applyTheme('system');
  };
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
