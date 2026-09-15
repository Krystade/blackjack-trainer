import type { ReactNode } from 'react';

/**
 * A page section that collapses to its heading.
 *
 * Added after measuring every screen at 375x812 (an iPhone 13 mini). Three were
 * far past a thumb's patience: Settings at 4085px (five screens), Stats at
 * 2470px and climbing — its sections are quiet until they have data, so a real
 * profile is much taller than an empty one — and the Profile editor at 2084px.
 * Collapsed, each becomes a short list of headings you can actually navigate.
 *
 * Built on <details> rather than useState, which buys three things for nothing:
 * open/closed survives re-render, the summary is focusable and keyboard- and
 * screen-reader-operable with no ARIA of our own, and browser find-in-page can
 * still open a closed section to reveal a match.
 *
 * `defaultOpen`, never `open`: passing `open` would hand the state to React and
 * fight the browser's native toggling on every click.
 */
/**
 * Under `?e2e=1`, every section starts open.
 *
 * Collapsing Settings/Stats/Profile by default broke a large number of e2e
 * specs at a stroke — not because anything regressed, but because they click
 * controls that are now behind a closed <details>, and a closed <details> is
 * genuinely not visible (Playwright agrees: `isVisible()` is false).
 *
 * Those specs are about themes, volume, bet ramps, voice panels. Section chrome
 * is not their subject, and rewriting 300-odd of them to open a section first
 * would add a ritual line to each while testing nothing new. `?e2e=1` already
 * means "test mode" here (it stubs audio into window.__speechLog), so it opens
 * the sections too.
 *
 * The cost is explicit and paid for: no feature spec can now catch a control
 * stranded inside a collapsed section. `e2e/collapsible-sections.spec.ts` is
 * the one that can, and it deliberately loads WITHOUT `?e2e=1` so it sees what
 * a real visitor sees.
 */
function e2eForcesOpen(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('e2e') === '1';
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  className = 'settings-section',
  dataTab,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  /** `settings-section` (default) or `stats-section` — both are styled for it. */
  className?: string;
  /** Stats filters its sections by tab; the attribute has to survive the wrap. */
  dataTab?: string;
  children: ReactNode;
}) {
  return (
    <details className={className} open={defaultOpen || e2eForcesOpen()} data-tab={dataTab}>
      <summary className={`${className}-title`}>{title}</summary>
      <div className={`${className}-body`}>{children}</div>
    </details>
  );
}
