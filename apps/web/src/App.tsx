import { useEffect } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useContent } from './content';
import { useSettings } from './lib/hooks';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { Onboarding } from './screens/Onboarding';
import { Placement } from './screens/Placement';
import { Learn } from './screens/Learn';
import { UnitView } from './screens/UnitView';
import { Review } from './screens/Review';
import { Tutor } from './screens/Tutor';
import { Progress } from './screens/Progress';
import { SettingsScreen } from './screens/Settings';
import { NotFound } from './screens/NotFound';
import { Grammar } from './screens/Grammar';
import { Pronunciation } from './screens/Pronunciation';

/** Loads content once, keeps the theme in sync and sends new learners to onboarding. */
function Root() {
  const settings = useSettings();
  const load = useContent((s) => s.load);
  const status = useContent((s) => s.status);
  const location = useLocation();

  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);

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
            { path: '/review', element: <Review /> },
            { path: '/tutor', element: <Tutor /> },
            { path: '/progress', element: <Progress /> },
            { path: '/settings', element: <SettingsScreen /> },
            { path: '*', element: <NotFound /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

export function App() {
  return <RouterProvider router={router} />;
}
