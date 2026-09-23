import { useEffect, useState } from 'react';
import './app.css';
import { Home } from './screens/Home';
import { Table } from './screens/Table';
import { Drills } from './screens/Drills';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { ProfileEditor } from './screens/ProfileEditor';
import { Charts } from './screens/Charts';
import { TabBar } from './components/TabBar';
import { MuteButton } from './components/MuteButton';
import { FieldTest } from './screens/FieldTest';
import { loadSettings } from '../store/persist';
import { applyTheme, normalizeTheme } from './theme';
import { getActiveProfile } from '../store/profiles';
import { subscribeToExternalWrites, OWNED_KEYS } from '../store/crossTab';
import type { Settings as SettingsData, Profile } from '../store/types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { startDiagnostics } from '../diag/environment';
import { diag } from '../diag/diagnosticLog';
import { invokeWheelCommand, type WheelCommand } from '../audio/wheelCommands';
import { releaseAudioFocus } from '../audio/audioFocus';

declare global {
  interface Window {
    /**
     * Deliver a steering-wheel press from a test. Present only under `?e2e=1`.
     *
     * A real press arrives through `navigator.mediaSession`, which a page
     * cannot trigger and Playwright cannot reach -- the car is the only thing
     * that can send one. Without a seam the entire wheel path would be
     * untestable end to end, which is unacceptable for the one input method
     * that has to work with the screen unwatched.
     */
    __wheelPress?: (command: WheelCommand) => boolean;
  }
}

export type Screen =
  | 'home'
  | 'table'
  | 'drills'
  | 'stats'
  | 'settings'
  | 'profiles'
  | 'charts'
  | 'fieldtest';

/** Human names for the "Back to ..." affordance. */
const SCREEN_LABEL: Record<Screen, string> = {
  home: 'Home',
  table: 'the Table',
  drills: 'Drills',
  stats: 'Stats',
  settings: 'Settings',
  profiles: 'Profiles',
  charts: 'Charts',
  fieldtest: 'the field test',
};

/**
 * A deliberate render throw, reachable ONLY by adding `?crash=1` to the URL.
 *
 * An error boundary that is never exercised is an error boundary that does
 * not work, and React needs a genuine render-time throw to trigger one --
 * there is no way to fake that from a test without a seam. This is that
 * seam: no UI references it, nothing links to it, and a user who never types
 * the parameter can never reach it. e2e/error-boundary.spec.ts drives it.
 */
function CrashOnDemand(): never {
  throw new Error('Deliberate crash for the error-boundary harness (?crash=1)');
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  /**
   * Where a Charts visit came FROM, so reviewing a chart mid-session can hand
   * you back to what you were doing. Charts is reachable from the tab bar at
   * any moment, and it used to offer only "Back to Home" -- which threw away
   * whatever drill or table you had open to go and check a cell.
   */
  const [chartsReturn, setChartsReturn] = useState<Screen>('home');
  const [settings, setSettings] = useState<SettingsData>(() => loadSettings());
  const [activeProfile, setActiveProfileState] = useState<Profile>(() => getActiveProfile());

  // Navigating away from the profiles screen re-reads the active profile,
  // since the picker/editor there can change it (select / save-while-active).
  // Publish the selected theme to <html>, where themes.css's [data-theme]
  // token blocks key off it. Runs on mount too, so a stored choice is applied
  // before the first paint the user notices.
  useEffect(() => {
    applyTheme(normalizeTheme(settings.theme));
  }, [settings.theme]);

  // The page-level watchers, installed once and left running.
  //
  // Deliberately here rather than in the voice hook: the events that explain a
  // dead microphone -- the page being hidden, frozen or unloaded, the audio
  // route flipping, permission changing -- happen precisely when the voice
  // hook is NOT mounted to see them, and a log that starts when listening
  // starts cannot record why listening stopped.
  // Test seam for the steering wheel; see Window.__wheelPress above.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.search.includes('e2e=1')) return;
    window.__wheelPress = (command) => invokeWheelCommand(command);
  }, []);

  useEffect(() => {
    startDiagnostics();
  }, []);

  // Give the car's media slot back when there is nothing here to control.
  //
  // The drills hold it for as long as they might speak, so a wheel press in
  // the SILENCE between prompts still reaches the app (audio/audioFocus.ts --
  // that gap is where the 2026-09-19 drive found the buttons dead). But a
  // silent loop that ran forever would keep the wheel pointed at a trainer
  // the operator left twenty minutes ago, so the moment there is no screen
  // here that speaks, the hold goes back.
  useEffect(() => {
    const speaks = screen === 'drills' || screen === 'table';
    if (!speaks || !settings.audio.enabled) releaseAudioFocus('speech');
  }, [screen, settings.audio.enabled]);

  // Cross-tab safety. Every store here writes a WHOLE blob, and each tab keeps
  // its own copy in React state -- so a second tab drilling against a snapshot
  // taken before this tab's write would later save that stale snapshot back
  // over it, silently discarding everything done in between. Re-reading when
  // another tab writes is what stops a tab from holding stale state long
  // enough to do that.
  //
  // The `storage` event never fires in the tab that performed the write, so
  // this cannot react to itself and needs no echo suppression.
  useEffect(() => {
    return subscribeToExternalWrites(OWNED_KEYS, () => {
      setSettings(loadSettings());
      setActiveProfileState(getActiveProfile());
    });
  }, []);

  const navigate = (next: Screen) => {
    if (screen === 'profiles' && next !== 'profiles') {
      setActiveProfileState(getActiveProfile());
    }
    // Remember the origin of a Charts visit, but never Charts itself -- a
    // second tap on the Charts tab must not make "back" a no-op loop.
    if (next === 'charts' && screen !== 'charts') setChartsReturn(screen);
    // Which screen was open bounds every other question about a session: the
    // voice vocabulary, the wake lock and the suppression behaviour all differ
    // between the table and a drill.
    diag('nav', 'screen', { from: screen, to: next });
    setScreen(next);
  };

  // See CrashOnDemand above: an opt-in seam so the boundary can be proven.
  const crashRequested =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('crash');

  const body = (() => {
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
            onSettingsChange={setSettings}
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
        return (
          <Stats
            settings={settings}
            onNavigate={navigate}
            onSettingsChange={setSettings}
            activeProfile={activeProfile}
          />
        );
      case 'settings':
        return <Settings settings={settings} onNavigate={navigate} onSettingsChange={setSettings} />;
      case 'profiles':
        return <ProfileEditor onNavigate={navigate} />;
      // Its own screen rather than a panel floating over a drill. The
      // protocol speaks its own lines now, so there is nothing for it to
      // float over -- see screens/FieldTest.tsx.
      case 'fieldtest':
        return (
          <FieldTest settings={settings} onSettingsChange={setSettings} onNavigate={navigate} />
        );
      case 'charts':
        // Charts reads getChart(activeProfile.rules) at render time, so unlike
        // Table it needs no remount key -- there is no long-lived Game instance
        // here to go stale, and `activeProfile` is already refreshed by
        // navigate() on the way out of the profiles screen.
        return (
          <Charts
            onNavigate={navigate}
            activeProfile={activeProfile}
            onBack={() => navigate(chartsReturn)}
            backLabel={SCREEN_LABEL[chartsReturn]}
          />
        );
    }
  })();

  return (
    <>
      {/* Wraps the SCREEN rather than the whole app, and is keyed by screen
          so navigating away clears a previous crash. This placement is the
          lesson from the incident where the stats screen threw: the app
          blanked, and "Reset Stats" was stranded on the crashing screen with
          no way to reach it. Keeping the boundary inside the shell means a
          broken screen leaves the tab bar below it alive, so the user can
          simply navigate somewhere else. */}
      <ErrorBoundary key={screen} onReset={() => navigate('home')}>
        {crashRequested ? <CrashOnDemand /> : body}
      </ErrorBoundary>
      {/* Rendered for every screen; app.css stands it down in the
          immersive modes, which own the bottom edge with their own
          ActionBar/ZonePad. */}
      {/* Outside the ErrorBoundary and outside every screen: silencing the
          app has to work on the immersive screens that stand the tab bar
          down, and on a screen that has just crashed. */}
      <MuteButton settings={settings} onSettingsChange={setSettings} />
      <TabBar current={screen} onNavigate={navigate} />
    </>
  );
}

export default App;
