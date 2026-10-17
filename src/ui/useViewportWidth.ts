import { useEffect, useState } from 'react';

/** The window's width, kept current across resizes and rotation. The felt's
 * CSS sizes cards from 100vw; this lets the same decision be made in JS. */
export function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 375 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    on();
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return w;
}
