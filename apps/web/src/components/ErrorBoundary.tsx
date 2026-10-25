import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';

/** Queues a crash report when the learner opted in (the code loads only when something broke). */
function report(error: unknown): void {
  void import('../lib/beta/crash').then((m) => m.reportCrash(error)).catch(() => undefined);
}

/** Friendly full-page fallback. Progress is stored on the device, so reloading loses nothing. */
export function CrashScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-10 text-center" role="alert" aria-labelledby="crash-title">
      <div aria-hidden="true" className="mx-auto flex w-8 flex-col items-center gap-1.5">
        <span className="h-3 w-3 rounded-full bg-gold" />
        <span className="h-3 w-3 rounded-full bg-swiss" />
      </div>
      <h1 id="crash-title" className="text-2xl font-bold">
        Something went wrong
      </h1>
      <p className="text-muted">Sorry, this screen stopped working. Your progress is saved on this device. Reloading usually fixes it.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <a href={import.meta.env.BASE_URL} className="btn-secondary">
          Go to Learn
        </a>
      </div>
    </main>
  );
}

/** Catches render errors outside the router (the router's own errors go to RouteError). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    report(error);
  }

  override render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

/** errorElement for the router: errors thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  useEffect(() => report(error), [error]);
  return <CrashScreen />;
}
