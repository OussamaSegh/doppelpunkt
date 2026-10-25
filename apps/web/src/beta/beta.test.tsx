import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FeedbackReport } from '@doppelpunkt/beta-schema';
import { db, getSettings, updateSettings } from '../db';
import { exercise, fixtureUnit } from '../test/fixtures';
import { clearBetaDb, COLLECTOR, json, mockFetch, setOnline } from '../test/beta';
import { ExercisePlayer } from '../exercise/ExercisePlayer';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Markdown } from '../components/Markdown';
import { resetOutboxBackoff } from '../lib/beta/outbox';
import { Beta } from '../screens/Beta';
import { Privacy } from '../screens/Privacy';
import { SettingsScreen } from '../screens/Settings';
import { Learn } from '../screens/Learn';
import { useContent } from '../content';

function wrap(ui: React.ReactNode, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

async function answerMcqWrong() {
  fireEvent.click(screen.getByRole('radio', { name: 'ist' }));
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
  await screen.findByText('Not quite');
}

beforeEach(async () => {
  vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
  resetOutboxBackoff();
  await clearBetaDb();
  useContent.getState().setPacks([{ level: 'A1', version: '0.4.0', builtAt: '2026-01-01T00:00:00.000Z', units: [fixtureUnit], exams: [] }]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Report a problem', () => {
  it('is not shown when this build has no collector', async () => {
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    wrap(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    await answerMcqWrong();
    expect(screen.queryByRole('button', { name: /report a problem/i })).not.toBeInTheDocument();
  });

  it('previews exactly what is sent, includes the answer only when ticked, and sends on Send', async () => {
    const m = mockFetch();
    vi.stubGlobal('fetch', m.fetch);
    wrap(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    await answerMcqWrong();
    fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
    const form = await screen.findByRole('form', { name: 'Report a problem' });
    // Not a nested <form> inside the exercise's form: that submits natively (a page navigation).
    expect(form.tagName).not.toBe('FORM');
    expect(document.querySelector('form form')).toBeNull();
    const send = within(form).getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    expect(within(form).getByText(/don't include personal details/i)).toBeInTheDocument();

    fireEvent.click(within(form).getByRole('radio', { name: 'Typo' }));
    fireEvent.change(within(form).getByLabelText('Comment (optional)'), { target: { value: 'bin is right' } });
    const preview = () => JSON.parse(within(form).getByLabelText('Exactly what will be sent').textContent ?? '{}') as FeedbackReport;
    expect(preview()).toMatchObject({ kind: 'feedback', itemId: 'a1-u01-mcq-1', unitId: 'a1-u01', reason: 'typo', comment: 'bin is right', contentVersion: '0.4.0' });
    expect(preview().answer).toBeUndefined();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Include my answer' }));
    expect(preview().answer).toBe('ist');
    const shown = preview();

    fireEvent.click(send);
    expect(await screen.findByText('Sent. Thank you!')).toBeInTheDocument();
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.body).toEqual([shown]);
    expect((await db.reports.toArray())[0]).toMatchObject({ status: 'sent', report: shown });
  });

  it("says it will send when you're online", async () => {
    setOnline(false);
    const m = mockFetch();
    vi.stubGlobal('fetch', m.fetch);
    wrap(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    await answerMcqWrong();
    fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
    const form = await screen.findByRole('form', { name: 'Report a problem' });
    fireEvent.click(within(form).getByRole('radio', { name: 'Unclear' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Will send when you're online/)).toBeInTheDocument();
    expect(m.calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it('Cancel closes the form without saving anything', async () => {
    wrap(<ExercisePlayer exercise={exercise('a1-u01-mcq-1')} unit={fixtureUnit} />);
    await answerMcqWrong();
    fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
    const form = await screen.findByRole('form', { name: 'Report a problem' });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Report a problem' })).not.toBeInTheDocument();
    expect(await db.reports.count()).toBe(0);
  });
});

describe('Settings: Help improve Doppelpunkt (beta)', () => {
  it('explains that the beta is not active without a collector', async () => {
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    wrap(<SettingsScreen />);
    const section = await screen.findByRole('region', { name: 'Help improve Doppelpunkt (beta)' });
    expect(within(section).getByText(/not active in this build/)).toBeInTheDocument();
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('has two opt-ins, both off; opting in creates an id, opting out forgets it', async () => {
    const m = mockFetch(() => json(200, {}));
    vi.stubGlobal('fetch', m.fetch);
    wrap(<SettingsScreen />);
    const section = await screen.findByRole('region', { name: 'Help improve Doppelpunkt (beta)' });
    const stats = within(section).getByRole('checkbox', { name: /anonymous item statistics/i });
    const crashes = within(section).getByRole('checkbox', { name: /crash reports/i });
    expect(stats).not.toBeChecked();
    expect(crashes).not.toBeChecked();
    expect(within(section).getByText(/only when you press Send/)).toBeInTheDocument();

    fireEvent.click(stats);
    await waitFor(async () => expect((await getSettings()).beta?.installId).toMatch(/^[a-f0-9]{32}$/));
    const id = (await getSettings()).beta!.installId!;
    expect(await within(section).findByText(/Your random beta id/)).toBeInTheDocument();
    expect(m.calls).toHaveLength(0);

    fireEvent.click(await within(section).findByRole('checkbox', { name: /anonymous item statistics/i, checked: true }));
    await waitFor(async () => expect((await getSettings()).beta?.installId).toBeUndefined());
    expect(m.calls).toEqual([{ url: `${COLLECTOR}/v1/forget`, body: { installId: id } }]);

    fireEvent.click(crashes);
    await waitFor(async () => expect((await getSettings()).beta?.crashes).toBe(true));
  });
});

describe('one-time beta card after onboarding', () => {
  it('shows once on Learn and goes away when dismissed', async () => {
    await updateSettings({ onboarded: true });
    wrap(<Learn />, '/learn');
    const card = await screen.findByRole('region', { name: 'Help improve Doppelpunkt (beta)' });
    expect(within(card).getByRole('checkbox', { name: /anonymous item statistics/i })).not.toBeChecked();
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Help improve Doppelpunkt (beta)' })).not.toBeInTheDocument());
    expect((await getSettings()).beta).toMatchObject({ introDone: true, stats: false, crashes: false });
  });

  it('is not shown without a collector', async () => {
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    await updateSettings({ onboarded: true });
    wrap(<Learn />, '/learn');
    await screen.findByRole('region', { name: 'Today' });
    expect(screen.queryByRole('region', { name: 'Help improve Doppelpunkt (beta)' })).not.toBeInTheDocument();
  });
});

describe('/beta screen', () => {
  it("shows what's new, the outbox and my reports", async () => {
    await db.reports.add({
      report: { kind: 'feedback', appVersion: '0.5.0', contentVersion: '0.4.0', itemId: 'a1-u01-mcq-1', unitId: 'a1-u01', reason: 'swiss-form', comment: 'Zurich says gaats', at: '2026-10-25T10:00:00.000Z' },
      status: 'queued',
      outboxId: 1,
    });
    await db.outbox.add({ kind: 'feedback', body: {} as never, createdAt: '', tries: 0 });
    wrap(<Beta />, '/beta');
    expect(screen.getByRole('heading', { level: 1, name: 'Doppelpunkt beta' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^What's new in / })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to give feedback' })).toBeInTheDocument();
    expect(await screen.findByText(/1 waiting: 1 report/)).toBeInTheDocument();
    const reports = await screen.findByRole('list', { name: 'My reports' });
    expect(within(reports).getByText(/Swiss form/)).toBeInTheDocument();
    expect(within(reports).getByText('Waiting to send')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'privacy notes' })).toHaveAttribute('href', '/privacy');
  });

  it('says the beta is not active without a collector', () => {
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    wrap(<Beta />, '/beta');
    expect(screen.getByText(/not active in this build/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting to be sent' })).not.toBeInTheDocument();
  });

  it('privacy screen renders the notice', () => {
    wrap(<Privacy />, '/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Notes for the operator/)).not.toBeInTheDocument();
  });
});

describe('crash screen', () => {
  it('shows a friendly reload screen when a component throws', () => {
    const Boom = () => {
      throw new Error('kaputt');
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('Markdown (document mode)', () => {
  it('renders tables, safe links and unwraps lines', () => {
    render(
      <Markdown
        headings="document"
        text={'## Kept\n\nOne line\ncontinues.\n\n| Data | Kept for |\n| --- | --- |\n| Crashes | 90 days |\n\n- item that\n  wraps\n\n[ok](https://example.org) [bad](javascript:alert(1))'}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Kept' })).toBeInTheDocument();
    expect(screen.getByText('One line continues.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kept for' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '90 days' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('item that wraps');
    expect(screen.getByRole('link', { name: 'ok' })).toHaveAttribute('href', 'https://example.org');
    expect(screen.queryByRole('link', { name: 'bad' })).not.toBeInTheDocument();
  });
});
