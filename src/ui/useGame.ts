import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game';
import type { GameConfig } from '../engine/game';
import type { Action } from '../engine/deviations';
import type { Category, GradedEvent } from '../engine/grade';
import type { Profile, Settings } from '../store/types';
import { loadStats, saveStats } from '../store/persist';
import { applyEvents } from '../store/stats';

export interface OverlayInfo {
  taken: Action;
  expected: string;
  reason: string;
  tc: number;
}

export interface ReportCategoryStat {
  category: Category;
  right: number;
  wrong: number;
  accuracy: number;
}

export interface SessionReport {
  categories: ReportCategoryStat[];
  mistakes: GradedEvent[];
  graded: number;
  correct: number;
  bankrollDelta: number;
}

function readSeed(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function buildReport(events: GradedEvent[], bankrollDelta: number): SessionReport {
  const byCategory = new Map<Category, { right: number; wrong: number }>();
  for (const ev of events) {
    const tally = byCategory.get(ev.category) ?? { right: 0, wrong: 0 };
    if (ev.correct) tally.right += 1;
    else tally.wrong += 1;
    byCategory.set(ev.category, tally);
  }
  const categories: ReportCategoryStat[] = Array.from(byCategory.entries()).map(([category, tally]) => ({
    category,
    right: tally.right,
    wrong: tally.wrong,
    accuracy: tally.right + tally.wrong > 0 ? tally.right / (tally.right + tally.wrong) : 0,
  }));

  return {
    categories,
    mistakes: events.filter((e) => !e.correct),
    graded: events.length,
    correct: events.filter((e) => e.correct).length,
    bankrollDelta,
  };
}

/**
 * Holds a single Game instance in a ref (so mutating engine calls don't
 * require immutable state plumbing) and forces a re-render via a version
 * counter after every engine call. All reads should go through `game`
 * directly (e.g. game.phase, game.hands) — it is always the live object.
 *
 * GameConfig is built from the ACTIVE PROFILE (penetration, betSpreadOn,
 * spread, bankrollStart, countCheckEvery, rules) — Cycle-1 Task 13: every
 * grading/payout/dealer-behavior surface reads the active profile, not
 * Settings. Settings only supplies non-game fields (feedbackMode here;
 * countPeek/dealSpeedMs/drill.* are read directly by the screens). The
 * `?seed=` override remains for deterministic e2e/test runs.
 */
export function useGame(settings: Settings, profile: Profile) {
  const gameRef = useRef<Game | null>(null);
  if (gameRef.current === null) {
    const cfg: GameConfig = {
      penetration: profile.penetration,
      betSpreadOn: profile.betSpreadOn,
      spread: profile.spread,
      bankrollStart: profile.bankrollStart,
      countCheckEvery: profile.countCheckEvery,
      rules: profile.rules,
      seats: profile.seats,
      seed: readSeed(),
    };
    gameRef.current = new Game(cfg);
  }
  const game = gameRef.current;

  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const [overlay, setOverlay] = useState<OverlayInfo | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);

  const deal = useCallback(
    (betUnits?: number | number[]) => {
      game.startRound(betUnits);
      bump();
    },
    [game, bump],
  );

  const insure = useCallback(
    (take: boolean) => {
      game.insuranceDecision(take);
      bump();
    },
    [game, bump],
  );

  const act = useCallback(
    (action: Action) => {
      const before = game.events.length;
      game.act(action);
      const newEvents = game.events.slice(before);
      if (settings.feedbackMode === 'training') {
        const wrong = newEvents.find((e) => e.kind === 'action' && !e.correct);
        if (wrong) {
          setOverlay({ taken: action, expected: wrong.expected, reason: wrong.reason, tc: wrong.tc });
        }
      }
      bump();
    },
    [game, bump, settings.feedbackMode],
  );

  const dismissOverlay = useCallback(() => setOverlay(null), []);

  /**
   * Paced bot-narration reveal (Cycle-2 Task 6). `game.botActionLog` is
   * fully populated by the engine SYNCHRONOUSLY (bots-before resolve inside
   * startRound(); bots-after resolve inside the player's final act()) — this
   * state/effect pair is DISPLAY-ONLY catch-up, never drives the engine.
   * `botNarrationRevealed` is how many of the CURRENT round's log entries
   * the UI has "caught up to"; a new round is detected by array identity
   * (startRound() reassigns `botActionLog = []` every round), which resets
   * the counter and cancels any in-flight timer so pacing never leaks
   * across rounds or narrates a stale-closure log.
   */
  const [botNarrationRevealed, setBotNarrationRevealed] = useState(0);
  const narrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrationLogRef = useRef<typeof game.botActionLog>(game.botActionLog);

  const clearNarrationTimer = useCallback(() => {
    if (narrationTimerRef.current !== null) {
      clearTimeout(narrationTimerRef.current);
      narrationTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let revealed = botNarrationRevealed;

    if (game.botActionLog !== narrationLogRef.current) {
      // New round (or a fresh empty log on a solo/no-bot table): reset.
      narrationLogRef.current = game.botActionLog;
      clearNarrationTimer();
      revealed = 0;
      if (botNarrationRevealed !== 0) {
        // State actually changes -> a follow-up render/effect run is
        // guaranteed, so let THAT pass schedule the timer against the new
        // log. (If it's already 0 — e.g. the very first round after mount —
        // setting it again would be a no-op React bails out on, so instead
        // fall through below and schedule inline against `revealed = 0`.)
        setBotNarrationRevealed(0);
        return;
      }
    }

    if (revealed >= game.botActionLog.length) {
      clearNarrationTimer();
      return;
    }

    if (narrationTimerRef.current === null) {
      narrationTimerRef.current = setTimeout(() => {
        narrationTimerRef.current = null;
        setBotNarrationRevealed((c) => c + 1);
      }, Math.max(0, settings.dealSpeedMs));
    }
  }, [
    game,
    game.botActionLog,
    // `botActionLog` is mutated in place (push) by bots-after resolving
    // mid-round inside act(); the array reference alone doesn't change then,
    // so `.length` is depended on separately to detect newly-appended
    // entries and resume pacing. A genuinely new round always reassigns the
    // array (caught by the reference check above), so relying on `.length`
    // here never masks a round boundary.
    game.botActionLog.length,
    botNarrationRevealed,
    settings.dealSpeedMs,
    clearNarrationTimer,
  ]);

  // Unmount-only cleanup so no timer outlives the component.
  useEffect(() => clearNarrationTimer, [clearNarrationTimer]);

  const fastForwardNarration = useCallback(() => {
    clearNarrationTimer();
    setBotNarrationRevealed(game.botActionLog.length);
  }, [game, clearNarrationTimer]);

  const submitCount = useCallback(
    (rc: number, tcGuess?: number) => {
      game.submitCountCheck(rc, tcGuess);
      bump();
    },
    [game, bump],
  );

  const endSession = useCallback((): SessionReport => {
    const events = game.events;
    const bankrollDelta = game.bankroll - profile.bankrollStart;

    const stats = loadStats();
    const updated = applyEvents(stats, events);
    updated.sessions.push({
      date: new Date().toISOString(),
      rounds: game.roundNo,
      graded: events.length,
      correct: events.filter((e) => e.correct).length,
      bankrollDelta,
      profileId: profile.id,
      profileName: profile.name,
    });
    saveStats(updated);

    const rep = buildReport(events, bankrollDelta);
    setReport(rep);
    return rep;
  }, [game, profile.bankrollStart, profile.id, profile.name]);

  return {
    game,
    deal,
    act,
    insure,
    submitCount,
    overlay,
    dismissOverlay,
    report,
    endSession,
    botNarrationRevealed,
    fastForwardNarration,
  };
}
