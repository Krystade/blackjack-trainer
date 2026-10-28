import { useEffect, useState } from 'react';
import type { Screen } from '../../App';
import type { Profile, Settings } from '../../../store/types';
import { loadStats } from '../../../store/persist';
import { localDayKey } from '../../../store/practiceDays';
import { takeGuidedLaunch } from '../../../guided/launch';
import { isResumable, type GuidedSession } from '../../../guided/session';
import { loadGuided } from '../../../guided/store';
import { GuidedSessionView } from './GuidedSessionView';
import { startGuided } from './guidedStart';

/**
 * Wave L (lane v): Drills' 'guided' mode. Runs the session Home handed over,
 * or today's stored one when there is no hand-over; with neither, the picker.
 */
export function GuidedEntry({
  settings,
  activeProfile,
  onSettingsChange,
  onNavigate,
  onNone,
}: {
  settings: Settings;
  activeProfile: Profile;
  onSettingsChange: (s: Settings) => void;
  onNavigate: (screen: Screen) => void;
  onNone: () => void;
}) {
  const [session, setSession] = useState<GuidedSession | null>(() => {
    const handed = takeGuidedLaunch();
    if (handed) return handed;
    const stored = loadGuided().active;
    return isResumable(stored, localDayKey(new Date())) ? stored : null;
  });
  useEffect(() => {
    if (!session) onNone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  if (!session) return null;
  return (
    <GuidedSessionView
      key={session.startedAt}
      initial={session}
      settings={settings}
      activeProfile={activeProfile}
      onSettingsChange={onSettingsChange}
      onHome={() => onNavigate('home')}
      onAgain={(prev) => setSession(startGuided(prev.preset, prev.drive, loadStats(), activeProfile, Date.now()))}
    />
  );
}
