import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ErrorBoundary, RouteError } from './components/ErrorBoundary';
import { useSettings } from './lib/hooks';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { Onboarding } from './screens/Onboarding';
import { Learn } from './screens/Learn';
import { NotFound } from './screens/NotFound';

/** Code-splits a screen with a named export (keeps the initial bundle small; see scripts/check-budget.mjs). */
function lazyScreen<M>(load: () => Promise<M>, name: keyof M): ComponentType {
  const Lazy = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return function Screen() {
    return (
      <Suspense
        fallback={
          <p role="status" className="p-6 text-center text-muted">
            Loading…
          </p>
        }
      >
        <Lazy />
      </Suspense>
    );
  };
}

const Placement = lazyScreen(() => import('./screens/Placement'), 'Placement');
const UnitView = lazyScreen(() => import('./screens/UnitView'), 'UnitView');
const Review = lazyScreen(() => import('./screens/Review'), 'Review');
const Tutor = lazyScreen(() => import('./screens/Tutor'), 'Tutor');
const Progress = lazyScreen(() => import('./screens/Progress'), 'Progress');
const SettingsScreen = lazyScreen(() => import('./screens/Settings'), 'SettingsScreen');
const Grammar = lazyScreen(() => import('./screens/Grammar'), 'Grammar');
const Pronunciation = lazyScreen(() => import('./screens/Pronunciation'), 'Pronunciation');
const Exam = lazyScreen(() => import('./screens/Exam'), 'Exam');
const Beta = lazyScreen(() => import('./screens/Beta'), 'Beta');
const Privacy = lazyScreen(() => import('./screens/Privacy'), 'Privacy');

/** Keeps the theme in sync and sends new learners to onboarding. */
function Root() {
  const settings = useSettings();
  const location = useLocation();

  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    return watchSystemTheme(() => theme);
  }, [theme]);

  if (!settings) {
    return (
      <p role="status" className="p-8 text-center text-muted">
        Loading…
      </p>
    );
  }
  const inOnboarding = location.pathname.startsWith('/welcome') || location.pathname.startsWith('/placement');
  if (!settings.onboarded && !inOnboarding) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

const router = createBrowserRouter(
  [
    {
      element: <Root />,
      errorElement: <RouteError />,
      children: [
        { path: '/welcome', element: <Onboarding /> },
        {
          element: <Layout />,
          children: [
            { index: true, element: <Navigate to="/learn" replace /> },
            { path: '/placement', element: <Placement /> },
            { path: '/learn', element: <Learn /> },
            { path: '/learn/:level', element: <Learn /> },
            { path: '/unit/:unitId', element: <UnitView /> },
            { path: '/unit/:unitId/:step', element: <UnitView /> },
            { path: '/grammar', element: <Grammar /> },
            { path: '/grammar/:unitId/:grammarId', element: <Grammar /> },
            { path: '/pronunciation', element: <Pronunciation /> },
            { path: '/pronunciation/:drillId', element: <Pronunciation /> },
            { path: '/exam', element: <Exam /> },
            { path: '/exam/:examId', element: <Exam /> },
            { path: '/review', element: <Review /> },
            { path: '/tutor', element: <Tutor /> },
            { path: '/progress', element: <Progress /> },
            { path: '/settings', element: <SettingsScreen /> },
            { path: '/beta', element: <Beta /> },
            { path: '/privacy', element: <Privacy /> },
            { path: '*', element: <NotFound /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

export function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
