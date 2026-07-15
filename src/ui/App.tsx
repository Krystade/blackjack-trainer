import { useState } from 'react';
import './app.css';
import { Home } from './screens/Home';
import { Table } from './screens/Table';
import { loadSettings } from '../store/persist';
import type { Settings } from '../store/types';

export type Screen = 'home' | 'table' | 'drills' | 'stats' | 'settings';

function Placeholder({ title, onNavigate }: { title: string; onNavigate: (screen: Screen) => void }) {
  return (
    <div className="placeholder-screen">
      <h1>{title}</h1>
      <p>Coming in a later task.</p>
      <button type="button" onClick={() => onNavigate('home')}>
        Back
      </button>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings] = useState<Settings>(() => loadSettings());

  switch (screen) {
    case 'home':
      return <Home onNavigate={setScreen} />;
    case 'table':
      return <Table settings={settings} onNavigate={setScreen} />;
    case 'drills':
      return <Placeholder title="Drills" onNavigate={setScreen} />;
    case 'stats':
      return <Placeholder title="Stats" onNavigate={setScreen} />;
    case 'settings':
      return <Placeholder title="Settings" onNavigate={setScreen} />;
  }
}

export default App;
