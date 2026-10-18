import { useEffect, useState } from 'react';

/**
 * H8: milliseconds from `now` to the next LOCAL midnight -- built from the
 * calendar date, so a 23- or 25-hour DST day still lands on 00:00.
 */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

/** Past midnight by this much, so a timer that fires a hair early still sees the new day. */
const MIDNIGHT_SLACK_MS = 1000;

/**
 * H8: a counter that goes up at each local midnight, and whenever the page
 * comes back into view or focus. Home computes "Practised N of the last 7
 * days" (and the ladder's due dates) from the clock at render; an app left
 * open overnight kept yesterday's window until something else re-rendered it.
 * Reading the returned value is enough to re-render on the new day.
 */
export function useDayTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    const bump = () => setTick((t) => t + 1);
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        bump();
        schedule();
      }, msUntilNextLocalMidnight(new Date()) + MIDNIGHT_SLACK_MS);
    };
    // Timers are throttled or frozen in a background tab, so coming back
    // re-reads the clock and re-arms the timer from the real time.
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return;
      bump();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, []);
  return tick;
}
