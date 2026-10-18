/**
 * WAVE I: `--vp-gap`, MEASURED INSTEAD OF ASSUMED.
 *
 * app.css sets `--vp-gap: calc(100svh - 100vh)` in the installed app and moves
 * every bottom-pinned bar (the tab bar, the drill bars, the sheets) down by
 * it. That encodes one WebKit bug (237961/316008): in a standalone,
 * `viewport-fit=cover` app, `position: fixed; bottom: 0` resolved against a
 * box short by the status-bar inset, so bars floated ~47px up.
 *
 * Jack's screenshot (2026-10-18, iPhone 13 mini, iOS home-screen app) shows
 * the opposite: the tab bar ~50px too LOW, its labels cut off by the bottom
 * of the screen. `svh` is still short there, but a fixed `bottom: 0` now
 * lands on the real bottom edge -- so subtracting the gap pushes the bar off
 * the screen. Which of the two a phone does is not knowable from CSS.
 *
 * So the gap is measured: a zero-height fixed probe at `bottom: 0` says where
 * the fixed box actually ends, and `screen` says how tall the screen is (a
 * standalone, viewport-fit=cover app covers all of it). Not `100vh`: if a
 * WebKit made `vh` too tall rather than `svh` too short, a vh reference would
 * push the bar off the screen all over again. Their difference is exactly how far a pinned bar must move: ~-47px on the
 * old WebKit, 0 on one that resolves fixed boxes against the screen. Only in
 * standalone; a browser tab keeps app.css's own value (0 there).
 */

/** The largest correction believed: a status bar plus slack. Anything beyond is a bad reading. */
const MAX_GAP_PX = 120;

/**
 * How far to move bottom-pinned bars (CSS px, never positive): where a fixed
 * `bottom: 0` box ends, less the screen height. 0 when they agree, when the
 * fixed box reaches further than the screen, or when a reading is unusable.
 */
export function vpGapPx(fixedBottom: number, screenHeight: number): number {
  if (!Number.isFinite(fixedBottom) || !Number.isFinite(screenHeight) || screenHeight <= 0) return 0;
  const gap = fixedBottom - screenHeight;
  if (gap >= -0.5 || gap < -MAX_GAP_PX) return 0;
  return Math.round(gap);
}

/** Measure once and publish `--vp-gap` on <html>. Returns the value set, or null outside standalone. */
export function applyViewportGap(doc: Document = document): number | null {
  const win = doc.defaultView;
  if (!win || !win.matchMedia('(display-mode: standalone)').matches) return null;
  const probe = (css: string) => {
    const el = doc.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `${css};left:0;width:0;visibility:hidden;pointer-events:none`;
    doc.body.appendChild(el);
    return el;
  };
  const fixed = probe('position:fixed;bottom:0;height:0');
  // iOS reports `screen` in portrait whatever the orientation.
  const { width, height } = win.screen;
  const screenHeight = win.innerWidth > win.innerHeight ? Math.min(width, height) : Math.max(width, height);
  const gap = vpGapPx(fixed.getBoundingClientRect().bottom, screenHeight);
  fixed.remove();
  doc.documentElement.style.setProperty('--vp-gap', `${gap}px`);
  return gap;
}

/** Measure now and again whenever the viewport can have changed. */
export function watchViewportGap(): void {
  if (typeof window === 'undefined' || !window.matchMedia('(display-mode: standalone)').matches) return;
  const run = () => requestAnimationFrame(() => applyViewportGap());
  run();
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
}
