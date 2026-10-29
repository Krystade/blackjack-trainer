import { useCallback, useEffect, useRef, useState } from 'react';
import { setLeaveGuard } from '../../leaveGuard';
import { useActivityLive } from '../../activityLive';
import { useCasinoLog } from './useCasinoLog';
import { CasinoHome, type CasinoSegment } from './CasinoHome';
import { CasinoDetail } from './CasinoDetail';
import { casinoById, loadCasinoLog, runningSession } from '../../../store/casinoLog';
import { CasinoForm } from './CasinoForm';
import { StartSession } from './StartSession';
import { EndSession } from './EndSession';
import { SessionForm } from './SessionForm';
import { GameStats } from './GameStats';
import { CasinoSettings } from './CasinoSettings';
import { AutoSim } from './AutoSim';
import './casino.css';
import './casinoGames.css';
import './casinoKinds.css';
import './casinoDirectory.css';

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
  /** Wave W: one casino's page, to read (the directory's row opens it). */
  | { kind: 'detail'; id: string }
  /**
   * The form; `from` is where Save, Cancel and Back return (the casino's
   * page, or a game's card, when opened there). Review S2: `focusGame` is
   * the game whose rules it was opened to edit, scrolled to.
   */
  | { kind: 'casino'; id: string | null; from?: CasinoView; focusGame?: string }
  | { kind: 'start' }
  | { kind: 'end'; sessionId: string }
  | { kind: 'session'; sessionId: string; from: CasinoView }
  | { kind: 'game'; casinoId: string; gameId: string; from?: CasinoView }
  | { kind: 'settings' };

const DISCARD_PROMPT = 'Discard what you entered on this form?';

export function Casino() {
  const { log, commit, saveFailed } = useCasinoLog();
  const [view, setView] = useState<CasinoView>({ kind: 'home' });
  const [dirty, setDirty] = useState(false);
  // Wave W: which part of home shows. Kept here so Back from a casino, a game
  // or a session lands on the part it was opened from. A running session
  // opens on Sessions, and a session starting switches there.
  const liveId = runningSession(log)?.id ?? null;
  const [segment, setSegment] = useState<CasinoSegment>(() => (liveId ? 'sessions' : 'casinos'));
  const seenLive = useRef(liveId);
  useEffect(() => {
    if (liveId !== null && liveId !== seenLive.current) setSegment('sessions');
    seenLive.current = liveId;
  }, [liveId]);

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

  const back =
    view.kind === 'session'
      ? () => go(view.from)
      : (view.kind === 'casino' || view.kind === 'game') && view.from
        ? () => go(view.from!)
        : home;
  // The form returns where it was opened from -- unless that was the page of
  // the casino it just deleted, or the card of a game it just removed (read
  // fresh: the save has just been made).
  const formFrom = view.kind === 'casino' ? view.from : undefined;
  const formGo = useCallback(
    (next: CasinoView) => {
      if (next.kind === 'home' && formFrom) go(stillThere(formFrom));
      else go(next);
    },
    [go, formFrom],
  );
  const detailName = view.kind === 'detail' ? casinoById(log, view.id)?.name : undefined;
  // A game's stats card goes back to the ranking it was opened from (home).
  const title =
    view.kind === 'home'
      ? 'Casino'
      : view.kind === 'detail'
        ? (detailName ?? 'Casino')
        : view.kind === 'casino'
        ? view.id
          ? 'Edit casino'
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
      body = <CasinoHome log={log} commit={commit} go={go} segment={segment} onSegment={setSegment} />;
      break;
    case 'detail':
      body = <CasinoDetail key={view.id} log={log} id={view.id} commit={commit} go={go} />;
      break;
    case 'casino':
      body = (
        <CasinoForm
          key={view.id ?? 'new'}
          log={log}
          id={view.id}
          focusGame={view.focusGame}
          self={{ kind: 'casino', id: view.id, from: view.from }}
          commit={commit}
          go={formGo}
          onDirty={setDirty}
        />
      );
      break;
    case 'start':
      body = <StartSession log={log} commit={commit} go={go} onDirty={setDirty} />;
      break;
    case 'end':
      body = <EndSession log={log} sessionId={view.sessionId} commit={commit} go={go} onDirty={setDirty} />;
      break;
    case 'game':
      body = <GameStats log={log} casinoId={view.casinoId} gameId={view.gameId} self={view} go={go} />;
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
      {/* Wave Q: every game's figures worked out on their own while Casino is open. */}
      <AutoSim log={log} openGame={view.kind === 'game' ? view.gameId : null} />
      {body}
    </div>
  );
}

/**
 * Where a form returns after a save: the view it was opened from, or the
 * nearest one still there -- a removed game's casino page, home for a
 * deleted casino.
 */
function stillThere(v: CasinoView): CasinoView {
  const log = loadCasinoLog();
  if (v.kind === 'detail') return casinoById(log, v.id) ? v : { kind: 'home' };
  if (v.kind === 'game') {
    const c = casinoById(log, v.casinoId);
    if (!c) return { kind: 'home' };
    return c.games.some((g) => g.id === v.gameId) ? v : v.from ? stillThere(v.from) : { kind: 'detail', id: c.id };
  }
  return v;
}
