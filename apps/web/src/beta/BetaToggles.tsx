import { useState } from 'react';
import type { BetaPrefs } from '../db';
import { errorMessage } from '../lib/ai';
import { setCrashOptIn, setStatsOptIn } from '../lib/beta/prefs';

/**
 * The beta choices. Feedback reports need no switch (each is sent only when you press Send);
 * item statistics and crash reports are separate opt-ins, off by default.
 */
export function BetaToggles({ beta, fetchImpl }: { beta: BetaPrefs; fetchImpl?: typeof fetch }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const run = async (fn: () => Promise<void>, text: string) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
      setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm">
        <span aria-hidden="true" className="mt-0.5 inline-block h-5 w-5 shrink-0 text-center text-muted">
          ⚑
        </span>
        <span>
          <span className="font-medium">Feedback reports</span>
          <span className="block text-xs text-muted">
            Always your choice, one report at a time: use "Report a problem" on an exercise. You see exactly what will be sent, and it goes
            only when you press Send.
          </span>
        </span>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={beta.stats}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            void run(
              () => setStatsOptIn(on, fetchImpl),
              on ? 'Thanks! Anonymous item statistics are on.' : 'Item statistics are off. Your random id was deleted and the server asked to forget it.',
            );
          }}
        />
        <span>
          <span className="font-medium">Share anonymous item statistics</span>
          <span className="block text-xs text-muted">
            Once a day at most: per exercise, how many tries, how well the first try went (in three bands) and time rounded to 5 seconds, with
            your rough level (e.g. A1+) and a random id that changes every 90 days. No answers, no names.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={beta.crashes}
          disabled={busy}
          onChange={(e) => {
            const on = e.target.checked;
            void run(() => setCrashOptIn(on), on ? 'Crash reports are on.' : 'Crash reports are off. Unsent reports were deleted.');
          }}
        />
        <span>
          <span className="font-medium">Send crash reports</span>
          <span className="block text-xs text-muted">
            When the app breaks: the error message and where it happened, with emails, links, long numbers and anything that looks like a key
            removed on this device first. Never your progress, answers or keys.
          </span>
        </span>
      </label>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-ok' : 'text-bad'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
