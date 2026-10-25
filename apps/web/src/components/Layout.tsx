import { NavLink, Outlet } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, updateSettings, type ThemePref } from '../db';
import { useActivityTimer, useSettings } from '../lib/hooks';
import { applyTheme } from '../lib/theme';
import { Logo } from './Logo';

type NavItem = { to: string; label: string; icon: string };

// 24px icon paths (outline style).
const NAV: NavItem[] = [
  { to: '/learn', label: 'Learn', icon: 'M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-4a3 3 0 0 0-2 1v13a2 2 0 0 1 2-2h4z' },
  { to: '/review', label: 'Review', icon: 'M4 7h12v12H4zM8 3h12v12' },
  { to: '/tutor', label: 'Tutor', icon: 'M4 5h16v10H9l-5 4z' },
  { to: '/progress', label: 'Progress', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { to: '/settings', label: 'Settings', icon: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4' },
];

const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

function NavIcon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function ThemeToggle() {
  const settings = useSettings();
  const pref = settings?.theme ?? 'system';
  const onClick = async () => {
    const next = THEME_NEXT[pref];
    applyTheme(next);
    await updateSettings({ theme: next });
  };
  return (
    <button type="button" className="btn-ghost px-3" onClick={onClick} aria-label={`${THEME_LABEL[pref]}. Switch theme`}>
      <span aria-hidden="true">{pref === 'dark' ? '☾' : pref === 'light' ? '☀' : '◐'}</span>
      <span className="text-xs text-muted">{pref}</span>
    </button>
  );
}

export function Layout() {
  useActivityTimer();
  const due = useLiveQuery(() => db.cards.where('due').belowOrEqual(new Date().toISOString()).count(), []);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] font-medium md:flex-none md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-sm ${
      isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'
    }`;

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <Logo />
          <span className="text-lg font-bold tracking-tight">Doppelpunkt</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={link}>
              <NavIcon d={n.icon} />
              {n.label}
              {n.to === '/review' && !!due && <DueBadge n={due} />}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-2 backdrop-blur md:hidden">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-bold">Doppelpunkt</span>
          </div>
          <ThemeToggle />
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4 md:pb-10 md:pt-8">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 flex gap-1 border-t border-line bg-surface px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5 md:hidden"
      >
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={link}>
            <span className="relative">
              <NavIcon d={n.icon} />
              {n.to === '/review' && !!due && <DueBadge n={due} floating />}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function DueBadge({ n, floating = false }: { n: number; floating?: boolean }) {
  return (
    <span
      className={`rounded-full bg-swiss px-1.5 text-[10px] font-bold text-white ${floating ? 'absolute -right-2 -top-1' : 'ml-auto'}`}
      aria-label={`${n} cards due`}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
