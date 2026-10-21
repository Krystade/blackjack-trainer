import { useMemo, type ReactNode } from 'react';
import type { Profile, Settings } from '../../../store/types';
import { emptyDeckMessage } from '../../../drills/deckSource';
import { HandDeckControls } from './HandDeckControls';
import { handDeckFor } from './handDeckFor';
import './handDeckControls.css';

/**
 * B2: a hand drill only mounts when its deck has something to deal. An empty
 * deck (no marked hands yet, no index plays among Soft hands, an empty Custom
 * painting) shows why, with the two controls that change it, instead of
 * reaching a draw that has nothing to draw from.
 *
 * The drill re-mounts once the deck is non-empty again, which is a fresh
 * session: there was no hand on screen to keep.
 */
export function HandDeckGate({
  title,
  settings,
  activeProfile,
  onSettingsChange,
  onBack,
  onCustomize,
  children,
}: {
  onCustomize?: () => void;
  title: string;
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (next: Settings) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const deck = useMemo(() => handDeckFor(settings.drill, activeProfile), [settings.drill, activeProfile]);
  if (deck.ids.length > 0) return <>{children}</>;
  return (
    <div className="drill-screen">
      <div className="drill-topbar">
        <button type="button" className="drill-back-btn" onClick={onBack}>
          Back
        </button>
        <div className="drill-heading">{title}</div>
      </div>
      <div className="drill-inline-controls">
        <HandDeckControls settings={settings} onChange={onSettingsChange} onCustomize={onCustomize} />
      </div>
      <p className="empty-deck" role="status" data-testid="empty-deck">
        {emptyDeckMessage(deck)}
      </p>
    </div>
  );
}
