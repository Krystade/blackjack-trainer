import { useState } from 'react';
import './app.css';
import { Home } from './screens/Home';
import { Table } from './screens/Table';
import { Drills } from './screens/Drills';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { loadSettings } from '../store/persist';
import type { Settings as SettingsData } from '../store/types';

export type Screen = 'home' | 'table' | 'drills' | 'stats' | 'settings';

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<SettingsData>(() => loadSettings());

  switch (screen) {
    case 'home':
      return <Home onNavigate={setScreen} />;
    case 'table':
      return <Table settings={settings} onNavigate={setScreen} />;
    case 'drills':
      return <Drills settings={settings} onNavigate={setScreen} />;
    case 'stats':
      return <Stats onNavigate={setScreen} onSettingsChange={setSettings} />;
    case 'settings':
      return <Settings settings={settings} onNavigate={setScreen} onSettingsChange={setSettings} />;
  }
}

export default App;
