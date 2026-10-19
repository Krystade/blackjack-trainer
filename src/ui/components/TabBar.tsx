import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { loadCasinoLog, runningSession, subscribeCasinoLog } from '../../store/casinoLog';
import './tabLive.css';

/**
 * Persistent bottom navigation (C4).
 *
 * Replaces a Home screen of five big buttons plus a "Back to Home" control on
 * every destination — an IA where every move between two sections cost two
 * taps and a full-screen detour. The five tabs are the places you actually
 * move between while training.
 *
 * Wave J: a sixth tab, Casino, for real play (screens/casino).
 *
 * #32 (spec 2026-10-13): Stats has a tab and Settings does not. The settings
 * that get changed mid-session now sit behind a gear on the tab they belong
 * to (TabSettingsButton), so the global Settings screen is reached from Home
 * and from each gear sheet's "All settings".
 *
 * The bar hides itself in the immersive modes (see app.css) rather than
 * taking a prop for it: the table and a running drill own the bottom edge
 * with their ActionBar/ZonePad, and on a 320px screen two stacked bottom bars
 * eat the hand.
 */

const TABS: { screen: Screen; label: string; glyph: string }[] = [
  { screen: 'home', label: 'Home', glyph: '◆' },
  { screen: 'table', label: 'Play', glyph: '♠' },
  { screen: 'drills', label: 'Drills', glyph: '◎' },
  { screen: 'charts', label: 'Charts', glyph: '▦' },
  { screen: 'stats', label: 'Stats', glyph: '◔' },
  // Wave J: real play, after everything that is practice. The club to Play's
  // spade: the same family of text glyph, so it takes the bar's ink and size.
  { screen: 'casino', label: 'Casino', glyph: '♣' },
];

/**
 * Is a real casino session on the clock? The Casino tab carries a dot while
 * one is, so a session left running is seen from every tab -- its hours keep
 * counting until it is ended.
 */
function useCasinoLive(): boolean {
  const read = () => {
    try {
      return runningSession(loadCasinoLog()) !== null;
    } catch {
      return false;
    }
  };
  const [live, setLive] = useState(read);
  useEffect(() => subscribeCasinoLog(() => setLive(read())), []);
  return live;
}

export function TabBar({
  current,
  onNavigate,
}: {
  current: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  const casinoLive = useCasinoLive();
  return (
    <nav className="tab-bar" aria-label="Main">
      {TABS.map((tab) => {
        const active = current === tab.screen;
        return (
          <button
            key={tab.screen}
            type="button"
            className={`tab-btn${active ? ' tab-btn-active' : ''}`}
            // The glyph is decoration, so without this the accessible name
            // comes out as "◎Drills" and no longer matches the label anyone
            // (or any spec) would look for.
            aria-label={tab.label}
            // The name stays "Casino" (specs and voice control find it by
            // that); the running session is its description instead.
            aria-describedby={tab.screen === 'casino' && casinoLive ? 'casino-tab-live-desc' : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(tab.screen)}
          >
            <span className="tab-glyph" aria-hidden="true">{tab.glyph}</span>
            {tab.screen === 'casino' && casinoLive && (
              <>
                <span className="tab-live-dot" data-testid="casino-tab-live" aria-hidden="true" />
                <span id="casino-tab-live-desc" className="u-sr-only">
                  Session running
                </span>
              </>
            )}
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
