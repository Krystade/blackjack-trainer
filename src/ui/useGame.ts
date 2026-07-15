import { useCallback, useRef, useState } from 'react';
import { Game } from '../engine/game';
import type { GameConfig } from '../engine/game';
import type { Action } from '../engine/deviations';
import type { Category, GradedEvent } from '../engine/grade';
import type { Settings } from '../store/types';
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
 */
export function useGame(settings: Settings) {
  const gameRef = useRef<Game | null>(null);
  if (gameRef.current === null) {
    const cfg: GameConfig = {
      penetration: settings.penetration,
      betSpreadOn: settings.betSpreadOn,
      spread: settings.spread,
      bankrollStart: settings.bankrollStart,
      countCheckEvery: settings.countCheckEvery,
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
    (betUnits?: number) => {
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

  const submitCount = useCallback(
    (rc: number, tcGuess?: number) => {
      game.submitCountCheck(rc, tcGuess);
      bump();
    },
    [game, bump],
  );

  const endSession = useCallback((): SessionReport => {
    const events = game.events;
    const bankrollDelta = game.bankroll - settings.bankrollStart;

    const stats = loadStats();
    const updated = applyEvents(stats, events);
    updated.sessions.push({
      date: new Date().toISOString(),
      rounds: game.roundNo,
      graded: events.length,
      correct: events.filter((e) => e.correct).length,
      bankrollDelta,
    });
    saveStats(updated);

    const rep = buildReport(events, bankrollDelta);
    setReport(rep);
    return rep;
  }, [game, settings.bankrollStart]);

  return { game, deal, act, insure, submitCount, overlay, dismissOverlay, report, endSession };
}
