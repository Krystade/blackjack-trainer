import type { Screen } from '../App';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

export function Home({ onNavigate }: HomeProps) {
  return (
    <div className="home-screen">
      <h1 className="home-title">Blackjack Trainer</h1>
      <div className="home-nav">
        <button type="button" className="home-nav-btn" onClick={() => onNavigate('table')}>
          Play
        </button>
        <button type="button" className="home-nav-btn" onClick={() => onNavigate('drills')}>
          Drills
        </button>
        <button type="button" className="home-nav-btn" onClick={() => onNavigate('stats')}>
          Stats
        </button>
        <button type="button" className="home-nav-btn" onClick={() => onNavigate('settings')}>
          Settings
        </button>
      </div>
    </div>
  );
}
