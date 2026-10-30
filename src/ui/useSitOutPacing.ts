import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game } from '../engine/game';
import { DEALER_SEAT, sitOutSteps, type DealStep } from './dealSequence';

/**
 * Wave X (item 1): "When sitting out, want the hands actually dealt ... not
 * just spawned in."
 *
 * With the player Out the engine plays the whole round inside `sitOut()`, so
 * the felt had every bot's hits, the turned hole card and the dealer's draws
 * the moment the round began -- only the opening two passes were staggered
 * (by CSS, at the deal speed). This paces the rest the same way: after the
 * opening, each bot turn, then the hole card, then each dealer draw, one deal
 * beat apart, in the order the round was really played (dealSequence.ts).
 *
 * DISPLAY ONLY. The round is graded, counted and narrated exactly as before;
 * nothing here touches the engine or the voice, so eyes-free is neither
 * slower nor chattier. Under prefers-reduced-motion, at a deal speed of 0,
 * or on a round the player is in, everything shows at once, as it did.
 */
export interface SitOutPacing {
  /** The round's steps (empty when this round is not paced). */
  steps: DealStep[];
  /** How many steps are on the felt so far. */
  shown: number;
  /** Steps still to come. */
  pending: boolean;
  /** Bot turns (botActionLog entries) on the felt so far. */
  botTurnsShown: number;
  /** The hole card has been turned (or the round never hid it). */
  holeShown: boolean;
  /** Dealer draws (cards past the first two) on the felt so far. */
  dealerDrawsShown: number;
  /** Put everything on the felt now (the Skip control). */
  finish: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSitOutPacing(game: Game, dealSpeedMs: number): SitOutPacing {
  // Seeded with the round already on the felt, so a mount never replays it.
  const [round, setRound] = useState<{ order: Game['dealOrder']; steps: DealStep[] }>(() => ({
    order: game.dealOrder,
    steps: [],
  }));
  const [shown, setShown] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A new round is a new dealOrder array (beginRound reassigns it).
  const order = game.dealOrder;
  if (round.order !== order) {
    const paced = game.hands.length === 0 && order.length > 0 && dealSpeedMs > 0 && !prefersReducedMotion();
    const steps = paced ? sitOutSteps(order, game.botActionLog, game.dealerCards.length, game.holeRevealed) : [];
    setRound({ order, steps });
    // The opening is staggered by CSS from this same instant: step i lands at i beats.
    setShown(steps.length > 0 ? 1 : 0);
  }

  const live = round.order === order;
  const steps = live ? round.steps : [];
  useEffect(() => {
    clear();
    if (!live || shown >= steps.length) return undefined;
    timer.current = setTimeout(() => {
      timer.current = null;
      setShown((n) => n + 1);
    }, dealSpeedMs);
    return clear;
  }, [live, shown, steps.length, dealSpeedMs, clear]);

  useEffect(() => clear, [clear]);

  const finish = useCallback(() => {
    clear();
    setShown(Number.MAX_SAFE_INTEGER);
  }, [clear]);

  if (steps.length === 0) {
    return { steps, shown: 0, pending: false, botTurnsShown: Infinity, holeShown: true, dealerDrawsShown: Infinity, finish };
  }
  const on = steps.slice(0, Math.min(shown, steps.length));
  const opening = order.length;
  const botTurnsShown = Math.max(0, Math.min(on.length - opening, game.botActionLog.length));
  const holeShown = !steps.some((s) => s.kind === 'reveal') || on.some((s) => s.kind === 'reveal');
  const dealerDrawsShown = on.filter((s) => s.kind === 'card' && s.seat === DEALER_SEAT && s.card >= 2).length;
  return {
    steps,
    shown: on.length,
    pending: on.length < steps.length,
    botTurnsShown,
    holeShown,
    dealerDrawsShown,
    finish,
  };
}
