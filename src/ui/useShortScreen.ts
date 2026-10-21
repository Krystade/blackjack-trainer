import { useEffect, useState } from 'react';

/**
 * Wave O: a phone-height screen too short for the table's message strip to
 * clear the sticky dock (320x568, iOS Display Zoom on an SE / mini). 375x812
 * is well above it.
 */
export const SHORT_SCREEN_QUERY = '(max-height: 640px)';

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SHORT_SCREEN_QUERY).matches;
}

export function useShortScreen(): boolean {
  const [short, setShort] = useState(matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(SHORT_SCREEN_QUERY);
    const on = () => setShort(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return short;
}
