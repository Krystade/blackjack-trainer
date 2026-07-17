import type { Screen } from '../App';
import type { Profile } from '../../store/types';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
  activeProfile: Profile;
}

export function Home({ onNavigate, activeProfile }: HomeProps) {
  return (
    <div className="home-screen">
      <h1 className="home-title">Blackjack Trainer</h1>
      <button
        type="button"
        className="home-profile-chip"
        onClick={() => onNavigate('profiles')}
      >
        {activeProfile.name}
      </button>
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
