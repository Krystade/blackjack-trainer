import { useState } from 'react';
import './app.css';
import { Home } from './screens/Home';
import { Table } from './screens/Table';
import { Drills } from './screens/Drills';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { ProfileEditor } from './screens/ProfileEditor';
import { loadSettings } from '../store/persist';
import { getActiveProfile } from '../store/profiles';
import type { Settings as SettingsData, Profile } from '../store/types';

export type Screen = 'home' | 'table' | 'drills' | 'stats' | 'settings' | 'profiles';

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<SettingsData>(() => loadSettings());
  const [activeProfile, setActiveProfileState] = useState<Profile>(() => getActiveProfile());

  // Navigating away from the profiles screen re-reads the active profile,
  // since the picker/editor there can change it (select / save-while-active).
  const navigate = (next: Screen) => {
    if (screen === 'profiles' && next !== 'profiles') {
      setActiveProfileState(getActiveProfile());
    }
    setScreen(next);
  };

  switch (screen) {
    case 'home':
      return <Home onNavigate={navigate} activeProfile={activeProfile} />;
    case 'table':
      // The key forces a remount whenever the active profile's CONTENT changes,
      // not merely when a different profile is selected. useGame builds its Game
      // instance once per mount, so keying on id alone left a stale Game running
      // after an in-place edit of the profile you were already playing.
      //
      // That was money-relevant for seats: Table reads playerHands live from the
      // profile while `selectedBets` and the engine's seat config both stayed at
      // their mount-time values. Editing 3 hands down to 1 and returning would
      // send a single scalar bet into an engine still holding 3 hands, which fans
      // it across all three — staking 3x what the bet UI showed. It never threw,
      // because the array length always matched what the engine expected.
      // Rules edits (decks, s17) were stale the same way, silently mis-grading.
      //
      // Remounting resets the shoe and bankroll, which is the correct reading of
      // "you changed the game definition": a new table, not a spliced-in change.
      return (
        <Table
          key={`${activeProfile.id}:${JSON.stringify(activeProfile)}`}
          settings={settings}
          onNavigate={navigate}
          activeProfile={activeProfile}
        />
      );
    case 'drills':
      return (
        <Drills
          settings={settings}
          onNavigate={navigate}
          onSettingsChange={setSettings}
          activeProfile={activeProfile}
        />
      );
    case 'stats':
      return <Stats onNavigate={navigate} onSettingsChange={setSettings} activeProfile={activeProfile} />;
    case 'settings':
      return <Settings settings={settings} onNavigate={navigate} onSettingsChange={setSettings} />;
    case 'profiles':
      return <ProfileEditor onNavigate={navigate} />;
  }
}

export default App;
