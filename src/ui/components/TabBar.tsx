import type { Screen } from '../App';

/**
 * Persistent bottom navigation (C4).
 *
 * Replaces a Home screen of five big buttons plus a "Back to Home" control on
 * every destination — an IA where every move between two sections cost two
 * taps and a full-screen detour. The five tabs are the places you actually
 * move between while training.
 *
 * Stats is deliberately NOT a tab: Home is now a dashboard whose whole job is
 * to answer "am I ready?", so it already carries the numbers, and the full
 * breakdown hangs off it. Settings earns its slot instead because audio and
 * feedback get changed mid-session.
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
  { screen: 'settings', label: 'Settings', glyph: '⚙' },
];

export function TabBar({
  current,
  onNavigate,
}: {
  current: Screen;
  onNavigate: (screen: Screen) => void;
}) {
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
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(tab.screen)}
          >
            <span className="tab-glyph" aria-hidden="true">{tab.glyph}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
