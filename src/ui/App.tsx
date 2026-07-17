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
      return <Table settings={settings} onNavigate={navigate} />;
    case 'drills':
      return <Drills settings={settings} onNavigate={navigate} onSettingsChange={setSettings} />;
    case 'stats':
      return <Stats onNavigate={navigate} onSettingsChange={setSettings} />;
    case 'settings':
      return <Settings settings={settings} onNavigate={navigate} onSettingsChange={setSettings} />;
    case 'profiles':
      return <ProfileEditor onNavigate={navigate} />;
  }
}

export default App;
