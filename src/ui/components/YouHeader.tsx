import { useEffect } from 'react';
import type { Screen } from '../App';
import { rememberYouView, type YouView } from '../youView';
import './youHeader.css';

const LABEL: Record<YouView, string> = { progress: 'Progress', stats: 'Stats' };

/**
 * Wave W: the You tab's switch, Progress | Stats, in the sticky bar at the
 * top of both screens. Each half is its own app screen, so a tap is a
 * navigation (the tab bar's You stays lit for either) and the one shown is
 * remembered for the next tap on You.
 */
export function YouHeader({ current, onNavigate }: { current: YouView; onNavigate: (s: Screen) => void }) {
  useEffect(() => rememberYouView(current), [current]);
  return (
    <div className="stats-topbar you-bar" data-testid="you-bar">
      <div className="you-seg" role="tablist" aria-label="You">
        {(['progress', 'stats'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            className={`you-seg-btn${v === current ? ' you-seg-btn-active' : ''}`}
            aria-selected={v === current}
            data-testid={`you-seg-${v}`}
            onClick={() => {
              if (v !== current) onNavigate(v);
            }}
          >
            {LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
