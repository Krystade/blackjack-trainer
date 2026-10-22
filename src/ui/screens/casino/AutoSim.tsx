import { useEffect, useMemo } from 'react';
import type { CasinoLog } from '../../../store/casinoLog';
import { buildRanking } from '../../casinoRanking';
import { newEditTracker, noteKeys, orderCandidates, sessionHolds } from '../../casinoAutoSim';
import { attachAuto, setAutoPlan } from './simRunner';
import { requestSideRow } from './sideRunner';
import { sideRowFor, sideRowSpec } from '../../../store/casinoSideRows';
import { useActiveProfile, useGameCache } from './useGameStats';

/**
 * Wave Q: the Casino screen's half of "figures follow the rules". Renders
 * nothing; while it is mounted the runner works out every game that needs it
 * (simRunner.ts), in the order the ranking gives (casinoAutoSim.ts), with the
 * game whose card is open first. Its own component so a result landing
 * re-renders this, not the form being typed into beside it.
 *
 * Side bets too: a game cut off its deck count's standard cut has its side
 * bets simulated at its own cut (store/casinoSideRows.ts), which used to wait
 * for its card to be opened; now the ranking asks for them as soon as the
 * cut (or the bet) is logged.
 */

/** Which games' inputs changed, kept for the page's life (a game edited, then Casino left and reopened, still goes first). */
const tracker = newEditTracker();

export function AutoSim({ log, openGame }: { log: CasinoLog; openGame: string | null }) {
  const profile = useActiveProfile();
  const { results, archive } = useGameCache(log);
  // At the table the phone is on and its battery matters: estimates only until the session ends
  // (or has gone 12 h with nothing logged to it: re-review R4).
  const sessionRunning = sessionHolds(log, Date.now());
  const rows = useMemo(() => buildRanking(log, profile, results, Date.now(), null, 'ev', archive), [log, profile, results, archive]);

  // The plan first, so attaching never starts a run from a previous visit's plan.
  useEffect(() => {
    noteKeys(
      tracker,
      rows.map((r) => ({ id: r.game.id, key: r.input.key })),
    );
    setAutoPlan(orderCandidates(rows, tracker.editedAt, profile.name), openGame, { sessionRunning });
  }, [rows, openGame, profile.name, sessionRunning]);
  useEffect(() => attachAuto(), []);
  useEffect(() => {
    for (const r of rows) {
      if (r.notModelled) continue;
      for (const sb of r.game.sideBets ?? []) if (!sideRowFor(r.game, sb)) requestSideRow(sideRowSpec(r.game, sb));
    }
  }, [rows]);
  return null;
}
