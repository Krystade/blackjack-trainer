/**
 * D5: scroll a drill's miss strip up out from under the sticky answer bar.
 *
 * On a short phone (320x568) the strip with "You played / Right play" renders
 * below the new hand, where the sticky action bar covers it; only the
 * "Wrong A,6 v 6" header showed. `scrollIntoView({block:'nearest'})` alone
 * stops at the viewport edge, which is still under the bar, so this measures
 * the bar and scrolls by exactly the overlap -- but never so far that the
 * strip's own top goes under the top bar, which on the shortest screen keeps
 * the verdict and the plays line in view ahead of the reason.
 */
export function revealAboveBar(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  const screen = el.closest('.drill-screen');
  if (!screen) return;
  const bar = screen.querySelector<HTMLElement>('.action-bar');
  const top = screen.querySelector<HTMLElement>('.drill-topbar');
  const r = el.getBoundingClientRect();
  const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  const ceiling = top ? top.getBoundingClientRect().bottom : 0;
  const over = r.bottom + 8 - barTop;
  if (over <= 0) return;
  const room = Math.max(0, r.top - ceiling - 8);
  const by = Math.min(over, room);
  if (by > 0) window.scrollBy({ top: by, behavior: 'instant' as ScrollBehavior });
}
