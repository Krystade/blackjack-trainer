import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game';
import type { GameConfig } from '../engine/game';
import type { Action } from '../engine/deviations';
import type { Category, GradedEvent } from '../engine/grade';
import type { Profile, Settings } from '../store/types';
import { loadStats, saveStats } from '../store/persist';
import { applyEvents } from '../store/stats';
import type { AudioApi } from '../audio/useAudio';
import {
  narrateBotAction,
  narrateCard,
  narrateCorrection,
  narrateCountAnswer,
  narrateCountPrompt,
  narrateDealerUp,
  narrateHandResult,
  narrateInsuranceOffer,
  narrateShuffle,
} from '../audio/narrate';

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
 * P1..P5 label for a bot seat, matching Table.tsx's `botSeatLabels` (counted
 * in casino seat order, independent of the player's own seat position). Kept
 * as a tiny local duplicate rather than a shared export -- cycle-3 Task 4's
 * scope is exactly {useAudio.ts, Table.tsx, useGame.ts} and this ~6-line
 * helper isn't worth adding a cross-file dependency for.
 */
function botLabelFor(game: Game, seatIndex: number): string {
  let n = 0;
  for (let i = 0; i <= seatIndex; i++) {
    if (game.seats[i]?.kind === 'bot') n += 1;
  }
  return `P${n}`;
}

/**
 * Phase-A ("full" verbosity) narration of the just-completed deal: shuffle
 * announcement, every dealt card in true casino dealing order (pass 1 --
 * one card per hand, seat order, bots included -- then the dealer's
 * up-card, then pass 2), and the insurance offer if the up-card is an ace.
 * The deal is fully synchronous in the engine (`startRound` returns with
 * every hand already dealt), and the table already renders all of this
 * instantly with no pacing of its own -- so speaking it synchronously,
 * right here, keeps audio in lockstep with what's already on screen. Only
 * the mid-round bot HIT/DOUBLE cards get paced (see the narration-reveal
 * effect below), because those are the only cards the UI itself paces.
 */
function narrateDeal(game: Game, audio: AudioApi): void {
  if (game.shuffledLastRound) {
    audio.say(narrateShuffle());
  }
  for (const seat of game.seats) {
    for (const hand of seat.hands) {
      if (hand.cards[0]) audio.sayFull(narrateCard(hand.cards[0]));
    }
  }
  if (game.dealerCards[0]) {
    audio.sayFull(narrateDealerUp(game.dealerCards[0].rank));
  }
  for (const seat of game.seats) {
    for (const hand of seat.hands) {
      if (hand.cards[1]) audio.sayFull(narrateCard(hand.cards[1]));
    }
  }
  if (game.phase === 'insurance') {
    audio.say(narrateInsuranceOffer());
  }
}

/**
 * Phase-A narration for a settlement that just happened as a direct result
 * of the caller's engine call (deal/insure/act can all end a round
 * synchronously -- an immediate dealer blackjack, an all-naturals table, or
 * the player's last hand finishing). No-ops when the call did NOT just
 * settle the round. Speaks: the dealer's hole card plus any cards drawn
 * during dealer play (full only -- the up-card and player/bot cards were
 * already spoken by `narrateDeal`/the bot-action pacing effect), each
 * hand's result, and the count-check prompt + attention chime if one is due.
 */
function narrateSettlement(game: Game, audio: AudioApi): void {
  if (game.phase !== 'settled') return;

  if (game.holeRevealed) {
    for (const card of game.dealerCards.slice(1)) {
      audio.sayFull(narrateCard(card));
    }
  }

  game.hands.forEach((hand, i) => {
    if (hand.result) {
      audio.say(narrateHandResult(i, game.hands.length, hand.result, hand.net ?? 0));
    }
  });

  if (game.countCheckDue) {
    audio.ding('attention');
    audio.say(narrateCountPrompt());
  }
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
export function useGame(settings: Settings, profile: Profile, audio: AudioApi) {
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
      narrateDeal(game, audio);
      narrateSettlement(game, audio); // instant dealer-blackjack / all-naturals rounds settle inside startRound()
      bump();
    },
    [game, bump, audio],
  );

  const insure = useCallback(
    (take: boolean) => {
      game.insuranceDecision(take);
      narrateSettlement(game, audio);
      bump();
    },
    [game, bump, audio],
  );

  const act = useCallback(
    (action: Action) => {
      const before = game.events.length;
      game.act(action);
      const newEvents = game.events.slice(before);
      if (settings.feedbackMode === 'training') {
        const actionEvent = newEvents.find((e) => e.kind === 'action');
        if (actionEvent) {
          audio.say(narrateCorrection(actionEvent));
          audio.ding(actionEvent.correct ? 'good' : 'bad');
        }
        const wrong = newEvents.find((e) => e.kind === 'action' && !e.correct);
        if (wrong) {
          setOverlay({ taken: action, expected: wrong.expected, reason: wrong.reason, tc: wrong.tc });
        }
      }
      narrateSettlement(game, audio);
      bump();
    },
    [game, bump, settings.feedbackMode, audio],
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
      // Captured once per scheduled tick (not read from the functional
      // setState updater below): only one timer is ever in flight at a time
      // (guarded by the `narrationTimerRef.current === null` check above),
      // and `revealed` only ever advances via that same timer's own
      // callback, so this closed-over value is still exactly the index
      // about to be revealed when the timeout fires -- no staleness. Cycle-3
      // Task 4: speaking here (rather than inside the setBotNarrationRevealed
      // updater) keeps the updater a pure function of its previous state,
      // which React's StrictMode double-invokes in dev to catch impurities
      // -- a speak() call inside the updater would double-narrate every line.
      const indexToReveal = revealed;
      narrationTimerRef.current = setTimeout(() => {
        narrationTimerRef.current = null;
        const entry = game.botActionLog[indexToReveal];
        if (entry) {
          audio.sayFull(narrateBotAction(botLabelFor(game, entry.seat), entry.action, entry.card));
        }
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
    audio,
  ]);

  // Unmount-only cleanup so no timer outlives the component.
  useEffect(() => clearNarrationTimer, [clearNarrationTimer]);

  const fastForwardNarration = useCallback(() => {
    clearNarrationTimer();
    setBotNarrationRevealed(game.botActionLog.length);
  }, [game, clearNarrationTimer]);

  const submitCount = useCallback(
    (rc: number, tcGuess?: number) => {
      const result = game.submitCountCheck(rc, tcGuess);
      audio.say(narrateCountAnswer(result.actualRc));
      audio.ding(result.rcCorrect ? 'good' : 'bad');
      bump();
    },
    [game, bump, audio],
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
