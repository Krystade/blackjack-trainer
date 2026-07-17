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
      // key={activeProfile.id} forces a remount on profile switch: useGame builds its
      // Game instance once per mount, so without this key a profile change (rules,
      // penetration, ramp, bankroll) would leave a stale Game running under the new profile.
      return <Table key={activeProfile.id} settings={settings} onNavigate={navigate} activeProfile={activeProfile} />;
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
