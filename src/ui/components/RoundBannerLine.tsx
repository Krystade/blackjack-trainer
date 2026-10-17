import { useLayoutEffect, useRef } from 'react';
import type { RoundBanner } from '../roundBanner';
import './roundBannerLine.css';

/**
 * One settled hand's banner (B5/W5), broken cleanly when it wraps (B2 #34).
 *
 * At 375px most banners take two lines, and the dot between the result and
 * the totals was left hanging at the end of the first ("Hand 1: Win +1 ·").
 * No CSS rule knows whether a centred inline run wrapped, so it is measured:
 * with the dot in place, if the totals start on a lower line than the result,
 * the banner is marked `data-wrapped` and CSS drops the dot and puts the
 * totals on a line of their own. Measured again on every text change and
 * every resize; the text itself (textContent) always keeps the dot.
 */
export function RoundBannerLine({ banner }: { banner: RoundBanner }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.removeAttribute('data-wrapped');
      const head = el.querySelector('.round-banner-head')?.getBoundingClientRect();
      const totals = el.querySelector('.round-banner-totals')?.getBoundingClientRect();
      if (head && totals && totals.top > head.top + head.height / 2) el.setAttribute('data-wrapped', '');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // The strip, not the banner: a centred banner is only as wide as its
    // text, so a wider screen does not resize it -- the strip it sits in does.
    // Toggling the mark restores the same size within one callback, so the
    // observer settles instead of looping.
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [banner.head, banner.totals]);
  return (
    <div ref={ref} className="message-result round-banner" data-net={banner.net}>
      <span className="round-banner-head">{banner.head}</span>
      <span className="round-banner-sep"> · </span>
      <span className="round-banner-totals">{banner.totals}</span>
    </div>
  );
}
