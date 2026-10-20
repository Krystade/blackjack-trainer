import { useCallback, useEffect, useState } from 'react';
import { setLeaveGuard } from '../../leaveGuard';
import { useActivityLive } from '../../activityLive';
import { useCasinoLog } from './useCasinoLog';
import { CasinoHome } from './CasinoHome';
import { CasinoForm } from './CasinoForm';
import { StartSession } from './StartSession';
import { EndSession } from './EndSession';
import { SessionForm } from './SessionForm';
import { GameStats } from './GameStats';
import { CasinoSettings } from './CasinoSettings';
import './casino.css';
import './casinoGames.css';

/**
 * WAVE J (lane C): THE CASINO TAB. The real-play notebook -- casinos, their
 * games and heat, and every real session in dollars (store/casinoLog.ts).
 *
 * Used standing in a casino, a bathroom or a car park, not driving: no voice,
 * big targets, numeric keypads. One screen with its own small stack of views
 * (home, a casino, start, end, a session) rather than five app screens, so
 * the tab bar's Casino tab is always the way home and the shell knows nothing
 * of the notebook's insides.
 */

export type CasinoView =
  | { kind: 'home' }
  | { kind: 'casino'; id: string | null }
  | { kind: 'start' }
  | { kind: 'end'; sessionId: string }
  | { kind: 'session'; sessionId: string; from: CasinoView }
  | { kind: 'game'; casinoId: string; gameId: string }
  | { kind: 'settings' };

const DISCARD_PROMPT = 'Discard what you entered on this form?';

export function Casino() {
  const { log, commit, saveFailed } = useCasinoLog();
  const [view, setView] = useState<CasinoView>({ kind: 'home' });
  const [dirty, setDirty] = useState(false);

  // A half-filled form survives a stray tab tap (it asks), and an update
  // reload waits while one is open: the end-of-session form is typed in the
  // gaps of a casino visit, with app switches in between.
  useEffect(() => {
    if (!dirty) return undefined;
    return setLeaveGuard(() => window.confirm(DISCARD_PROMPT));
  }, [dirty]);
  useActivityLive('casino:form', dirty);

  const go = useCallback((next: CasinoView) => {
    setDirty(false);
    setView(next);
    window.scrollTo(0, 0);
  }, []);
  const home = useCallback(() => go({ kind: 'home' }), [go]);

  const back = view.kind === 'session' ? () => go(view.from) : home;
  // A game's stats card goes back to the ranking it was opened from (home).
  const title =
    view.kind === 'home'
      ? 'Casino'
      : view.kind === 'casino'
        ? view.id
          ? 'Casino details'
          : 'New casino'
        : view.kind === 'start'
          ? 'Start a session'
          : view.kind === 'end'
            ? 'End session'
            : view.kind === 'game'
              ? 'Game stats'
              : view.kind === 'settings'
                ? 'Casino settings'
                : 'Edit session';

  let body;
  switch (view.kind) {
    case 'home':
      body = <CasinoHome log={log} commit={commit} go={go} />;
      break;
    case 'casino':
      body = <CasinoForm key={view.id ?? 'new'} log={log} id={view.id} commit={commit} go={go} onDirty={setDirty} />;
      break;
    case 'start':
      body = <StartSession log={log} commit={commit} go={go} onDirty={setDirty} />;
      break;
    case 'end':
      body = <EndSession log={log} sessionId={view.sessionId} commit={commit} go={go} onDirty={setDirty} />;
      break;
    case 'game':
      body = <GameStats log={log} casinoId={view.casinoId} gameId={view.gameId} go={go} />;
      break;
    case 'settings':
      body = <CasinoSettings log={log} commit={commit} />;
      break;
    case 'session':
      body = (
        <SessionForm
          key={view.sessionId}
          log={log}
          sessionId={view.sessionId}
          commit={commit}
          done={() => go(view.from)}
          onDirty={setDirty}
        />
      );
      break;
  }

  return (
    <div className="casino-screen" data-testid="casino-screen" data-view={view.kind}>
      <div className="casino-topbar">
        {view.kind !== 'home' && (
          <button type="button" className="cas-back" onClick={back}>
            <span aria-hidden="true">‹ </span>Back
          </button>
        )}
        <h1 className="casino-heading">{title}</h1>
      </div>
      {saveFailed && (
        <p className="cas-save-failed" role="alert">
          Not saved: this phone&rsquo;s storage is full. Export the log now so nothing is lost.
        </p>
      )}
      {body}
    </div>
  );
}
