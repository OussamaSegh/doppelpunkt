import { useEffect, useRef, useState } from 'react';

/**
 * A pausable countdown for one exam section. Time is measured with Date.now (so a throttled
 * background tab still counts correctly) and only while not paused. `onExpire` fires once.
 * Remount (key) the component for a new section.
 */
export function useCountdown(totalSec: number, paused: boolean, onExpire: () => void) {
  const usedMs = useRef(0);
  const last = useRef<number | null>(null);
  const expired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  const [left, setLeft] = useState(totalSec);

  useEffect(() => {
    if (paused || expired.current) return;
    last.current = Date.now();
    const tick = () => {
      const now = Date.now();
      usedMs.current += now - (last.current ?? now);
      last.current = now;
      const remaining = Math.max(0, totalSec - usedMs.current / 1000);
      setLeft(Math.ceil(remaining));
      if (remaining <= 0 && !expired.current) {
        expired.current = true;
        cb.current();
      }
    };
    const id = setInterval(tick, 250);
    return () => {
      clearInterval(id);
      const now = Date.now();
      usedMs.current += now - (last.current ?? now);
      last.current = null;
    };
  }, [paused, totalSec]);

  /** Seconds used so far (pauses excluded), including the running interval. */
  const usedSec = () => {
    const extra = last.current !== null ? Date.now() - last.current : 0;
    return Math.min(totalSec, (usedMs.current + extra) / 1000);
  };
  return { left, usedSec };
}
