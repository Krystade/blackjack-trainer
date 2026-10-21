import { useCallback, useEffect, useRef, useState } from 'react';
import { Game, handPlayNumber } from '../engine/game';
import type { Action } from '../engine/deviations';
import type { Card, Rank } from '../engine/cards';
import type { Category, GradedEvent, MistakeClass } from '../engine/grade';
import type { Profile, Settings } from '../store/types';
import { loadStats, saveStats } from '../store/persist';
import { applyEvents } from '../store/stats';
import { notePracticeDay } from '../store/practiceDays';
import { resumeBankroll, storeBankrollNow } from './playBankroll';
import { hotShoeActive } from '../engine/shoeBias';
import { playConfigFor } from './playConfig';
import { datedSessionEvents } from './sessionEvents';
import { makePlayGame, realignLosingShoe, type PlayGame } from './losingShoe';
import type { AudioApi } from '../audio/useAudio';
import { lockstepTell, type BetRound, type LockstepTell } from '../engine/coverBets';
import { mistakeUnits } from './reportSections';
import { newSessionId, sessionRowFor, upsertSession } from './sessionRow';
import { betMissFeedback, type BetMiss } from './betFeedback';
import { sessionDealerErrors } from './dealerErrorCopy';
import { addSideDecisions } from '../store/sideBetStats';
import { SIDE_OFF_LINE, SIDE_ON_LINE, SIDE_WINS_LINE, sideMissFeedback } from './sideBetFeedback';
import type { SideMiss } from './sideBetFeedback';
import {
  narrateBotAction,
  narrateCard,
  narrateCorrection,
  narrateCountAnswer,
  narrateDealerUp,
  narrateHandResult,
  narrateInsuranceOffer,
  narrateShuffle,
  narrateSitOut,
  narrateInOut,
  narrateTableCountPrompt,
} from '../audio/narrate';

export interface OverlayInfo {
  taken: Action;
  expected: string;
  reason: string;
  tc: number;
  /** The matchup in table notation, e.g. "10,6 v 10". Carried so the table's
   * correction can name the hand it is about — with the round already moved
   * on underneath the modal, "you should have stood" is otherwise ambiguous
   * about WHICH hand when a split is in play. */
  hand?: string;
  /** Lets the shared MistakeCard name the KIND of error (basic vs missed
   * index vs phantom index), which the engine already classifies. */
  classification?: MistakeClass;
  /**
   * The hand as it stood WHEN THE DECISION WAS GRADED, plus the dealer
   * upcard, so "Show me the table" (#7) can ring the cell this mistake
   * actually belongs to.
   *
   * Snapshotted rather than read live off the game: by the time the overlay
   * is on screen the engine has already applied the action, so the hand may
   * have drawn a card, busted, or handed `active` to the next split hand.
   * Reading it live would highlight a cell the learner was never asked
   * about.
   */
  cards?: Card[];
  dealerUp?: Rank;
  /**
   * Whether splitting was on the table for THAT decision.
   *
   * Snapshotted for the same reason as `cards`: read live, `game.legalActions()`
   * describes the state AFTER the action was applied — it returns [] outside
   * the player phase and never contains 'split' for a 3-card hand, so it was
   * effectively always false by the time the overlay mounted, and a missed
   * split on 8,8 rang HARD:16 instead of PAIRS:8. Mid-split it can be wrongly
   * TRUE, because `active` has already moved to a different hand.
   */
  canSplit?: boolean;
}

export interface ReportCategoryStat {
  category: Category;
  right: number;
  wrong: number;
  accuracy: number;
}

/** A graded table count check, as the screen shows it (#36 follow-up). */
export interface CountCheckVerdict {
  rcGuess: number | null;
  rcCorrect?: boolean;
  actualRc: number;
  tcGuess?: number;
  tcCorrect?: boolean;
  actualTc?: number;
  /** The round dealt right after the answer: the verdict shows until a later
   * round is dealt. */
  round: number;
}

export interface SessionReport {
  categories: ReportCategoryStat[];
  mistakes: GradedEvent[];
  graded: number;
  correct: number;
  bankrollDelta: number;
  // R7 (docs/BACKLOG.md): number of RC/TC peek-button activations this
  // session, so the report can flag a peek-assisted accuracy.
  peeks: number;
  /**
   * RT#11: how mechanically this session's bets tracked the count. Reported
   * whether or not cover grading is on -- the tolerance makes room for cover,
   * but only this says whether any was taken.
   */
  cover: LockstepTell;
  /** Wave B, B6: player hands settled this session (splits count separately). */
  hands: number;
  /** Wave B, B6: units lost to priced mistakes (sum of evCost). */
  mistakeUnits: number;
  /** Wave B, B8: dealt from a Hot shoe, so the bankroll was not kept. */
  hotShoe: boolean;
  /**
   * F5 (W2-17): decisions taken with the dealer-pace clock running, and how
   * many of those it ran out on. The report shows the slow count only when
   * the clock ran for at least one decision.
   */
  pacedDecisions: number;
  slowDecisions: number;
  /**
   * G2 (L-8): dealer payout errors made, caught with Foul, and false calls.
   * Null for a session played with Dealer mistakes off. Not graded events:
   * it moves no accuracy figure.
   */
  dealerErrors: { made: number; caught: number; falseCalls: number } | null;
  /** Wave I: some round was dealt with Dealer mistakes on Training (about 1 in 5). */
  dealerMistakesTraining: boolean;
}

/** F5: what the screen measured about one Play decision (see Game.act). */
export interface DecisionTiming {
  elapsedMs?: number;
  slow?: boolean;
  /** The dealer-pace clock was running for this decision. */
  paced?: boolean;
}

/**
 * Table Realism (Request B): true while the opening deal's CSS entrance
 * animation is still plausibly playing, purely so Table.tsx knows how long
 * to keep offering a skip control. It NEVER gates which cards are in the
 * DOM -- every card in `game.dealOrder` is already rendered, with its real
 * `data-card`/attributes, on the exact render `game.startRound()`/
 * `game.sitOut()` returns from; only its CSS `animation-delay` (computed
 * from `--deal-i`, see PlayingCard.tsx) is staggered. A caller that ignores
 * `dealAnimating`/`skipDeal` entirely sees the identical DOM, at the
 * identical moment, either way -- this is why gating the skip control on it
 * cannot desync grading, the running count, or e2e/table-seats.spec.ts's
 * fast-forward path.
 *
 * Suppressed entirely under prefers-reduced-motion: reduce -- under that
 * preference app.css's card-deal-in keyframe is never applied at all (see
 * app.css), so there is nothing playing to offer a skip control for.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Must match app.css's `card-deal-in` keyframe duration -- a comment there
// points back here.
const DEAL_ENTRANCE_MS = 220;

function readSeed(): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function buildReport(
  events: GradedEvent[],
  bankrollDelta: number,
  peeks: number,
  hands: number,
): Omit<SessionReport, 'hotShoe' | 'pacedDecisions' | 'dealerErrors' | 'dealerMistakesTraining'> {
  // RT#11: read the bets back off the graded events. `taken`/`expected` are
  // strings on the event, and a bet event always carries both as numbers, so
  // an unparseable pair means something upstream changed shape -- dropped
  // rather than counted as a match, which would quietly deflate the ratio.
  const betRounds: BetRound[] = events
    .filter((e) => e.kind === 'bet')
    .map((e) => ({ taken: Number(e.taken), expected: Number(e.expected) }))
    .filter((r) => Number.isFinite(r.taken) && Number.isFinite(r.expected));
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
    peeks,
    cover: lockstepTell(betRounds),
    hands,
    mistakeUnits: mistakeUnits(events),
    slowDecisions: events.filter((e) => e.slow === true).length,
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
 * one card per hand, seat order from first base, bots included, and within
 * a seat from the rightmost hand, as the engine deals it -- then the
 * dealer's up-card, then pass 2), and the insurance offer if the up-card is
 * an ace.
 * The deal is fully synchronous in the engine (`startRound` returns with
 * every hand already dealt), and the table already renders all of this
 * instantly with no pacing of its own -- so speaking it synchronously,
 * right here, keeps audio in lockstep with what's already on screen. Only
 * the mid-round bot HIT/DOUBLE cards get paced (see the narration-reveal
 * effect below), because those are the only cards the UI itself paces.
 */
export function narrateDeal(
  game: Game,
  audio: Pick<AudioApi, 'say' | 'sayFull'>,
  shuffleAlreadySaid = false,
): void {
  // Wave A: the shuffle is normally announced between rounds, before the bet
  // (see narrateSettlement / submitCount); said here only if it was not.
  if (game.shuffledLastRound && !shuffleAlreadySaid) {
    audio.say(narrateShuffle());
  }
  for (const seat of game.seats) {
    for (const hand of [...seat.hands].reverse()) {
      if (hand.cards[0]) audio.sayFull(narrateCard(hand.cards[0], 'rank'));
    }
  }
  if (game.dealerCards[0]) {
    audio.sayFull(narrateDealerUp(game.dealerCards[0].rank));
  }
  for (const seat of game.seats) {
    for (const hand of [...seat.hands].reverse()) {
      if (hand.cards[1]) audio.sayFull(narrateCard(hand.cards[1], 'rank'));
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
 * hand's result. The count check is NOT asked here any more (#36): it is
 * posed when the next deal is asked for -- see `poseCountCheckBeforeDeal`.
 */
function narrateSettlement(game: Game, audio: AudioApi): boolean {
  if (game.phase !== 'settled') return false;

  if (game.holeRevealed) {
    for (const card of game.dealerCards.slice(1)) {
      audio.sayFull(narrateCard(card, 'rank'));
    }
  }

  // Wave L: a side bet that won is said (a loss is the bet's normal end, and silent).
  const side = game.sideDecisionThisRound;
  if (side?.placed && side.net !== undefined && side.net > 0) audio.say(SIDE_WINS_LINE);

  // In order of play (#1): the rightmost hand is played first and is "hand
  // one", so results are read from the right.
  for (let i = game.hands.length - 1; i >= 0; i--) {
    const hand = game.hands[i];
    if (hand.result) {
      audio.say(
        narrateHandResult(handPlayNumber(i, game.hands.length) - 1, game.hands.length, hand.result, hand.net ?? 0),
      );
    }
  }

  // s06: the cut card came out this round, so the next bet goes into a fresh
  // shoe. Said now, before that bet, as the screen says it -- unless a count
  // check is owed: it grades the count BEFORE the shuffle, so "Shuffling."
  // then "Running count?" would ask for a 0 that is marked wrong. Then it is
  // said once the check is answered (submitCount). Returns whether it was said.
  if (game.shuffleDue && !game.countCheckDue) {
    sayShuffleBetweenRounds(game, audio);
    return true;
  }
  return false;
}

/**
 * "Shuffling." between rounds -- and, with "start each shoe out", "Out.": the
 * fresh shoe starts with the toggle Out, and the next forward press then deals
 * the player out (review S4, toggle rework).
 */
function sayShuffleBetweenRounds(game: Game, audio: Pick<AudioApi, 'say'>): void {
  audio.say(narrateShuffle());
  if (game.startShoeOut) audio.say(narrateInOut(false));
}

/** What the player asked for when an owed count check interrupted it (#36).
 * It runs as soon as the check is answered. Ending the session is one of
 * them: the last round's check is asked before the report, not dropped. */
type PendingDeal = { kind: 'deal'; bets?: number | number[] } | { kind: 'sitOut' } | { kind: 'end' };

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
 * dealSpeedMs/drill.* are read directly by the screens). The
 * `?seed=` override remains for deterministic e2e/test runs.
 */
export function useGame(settings: Settings, profile: Profile, audio: AudioApi) {
  const playRef = useRef<PlayGame | null>(null);
  if (playRef.current === null) {
    // #42: the bankroll carries over from the last session on this profile.
    const cfg = playConfigFor(profile, resumeBankroll(profile), readSeed());
    // #48-51: the Losing shoe setting picks the rig at build time.
    playRef.current = makePlayGame(cfg, settings.losingShoe === true);
  }
  const playGame = playRef.current;
  const game = playGame.game;
  const losingShoe = playGame.boundaries !== null;

  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /**
   * F1: graded events committed to Stats so far. Each round's events are
   * written as the round SETTLES (and a count check's as it is answered), so
   * a reload, an iOS eviction or leaving through the gear loses nothing that
   * was already decided.
   *
   * Wave B2, R1: in the same write, this session's row -- one per Table
   * mount, keyed by `sessionIdRef` -- is upserted as provisional, so a shoe
   * that is never ended (the car's normal case: iOS evicts the page) is still
   * a session in Stats, and its rounds, events, row and bankroll can never
   * disagree. End finalises the same row. F22: nothing is written before the
   * first round.
   */
  const committedRef = useRef(0);
  /** Wave L: side-bet decisions committed to Stats so far (as `committedRef`). */
  const sideCommittedRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current ??= newSessionId();
  /** R7: peek reveals this session, counted here so the provisional row has them. */
  const peeksRef = useRef(0);
  const notePeek = useCallback(() => {
    peeksRef.current += 1;
  }, []);
  /** F5: decisions taken with the dealer-pace clock running, this session. */
  const pacedRef = useRef(0);
  /** What the last row write described, so an unchanged render writes nothing. */
  const rowKeyRef = useRef('');
  /** End has finalised the row; nothing may turn it provisional again. */
  const endedRef = useRef(false);
  const profileName = profile.name;
  const profileId = profile.id;
  // Wave B, B8: a Hot shoe session's bankroll is never written back.
  const hotShoe = hotShoeActive(game.cfg, game.isRigged);

  const persistSession = useCallback(
    (final: boolean) => {
      if (game.roundNo === 0 || endedRef.current) return;
      const fresh = game.events.length > committedRef.current;
      const t = game.dealerErrorTally;
      const side = game.cfg.sideBet;
      const freshSide = side !== undefined && game.sideDecisions.length > sideCommittedRef.current;
      const key = `${game.roundNo}|${game.events.length}|${game.bankroll}|${peeksRef.current}|${t.made}/${t.caught}/${t.falseCalls}|${game.dealerMistakesTrainingUsed}|${game.sideDecisions.length}/${game.sideTally.net}|${final}`;
      if (!fresh && !freshSide && key === rowKeyRef.current) return;
      const now = new Date().toISOString();
      let stats = loadStats();
      if (fresh) {
        // #25: dated as they are committed, so Play's priced mistakes land in
        // the cost-of-mistakes history inside a Stats time range.
        stats = applyEvents(stats, datedSessionEvents(game.events.slice(committedRef.current), now), now);
        committedRef.current = game.events.length;
      }
      // Wave L: the side bet's settled decisions, by bet.
      if (side && freshSide) {
        stats = addSideDecisions(stats, side.bet, game.sideDecisions.slice(sideCommittedRef.current));
        sideCommittedRef.current = game.sideDecisions.length;
      }
      // F10: a Play round was recorded today (a session row's own date moves
      // with every round, so a shoe played across midnight keeps both days).
      stats = notePracticeDay(stats, now);
      stats = upsertSession(
        stats,
        sessionRowFor({
          id: sessionIdRef.current!,
          date: now,
          rounds: game.roundNo,
          hands: game.handsPlayed,
          events: game.events,
          // From where THIS session started (#42), not the profile's original stake.
          bankrollDelta: game.bankroll - game.cfg.bankrollStart,
          profileId,
          profileName,
          peeks: peeksRef.current,
          hotShoe,
          provisional: !final,
          ...sessionDealerErrors(game.dealerErrorTally, game.dealerMistakesUsed, game.dealerMistakesTrainingUsed),
        }),
      );
      if (side && game.sideDecisions.length > 0) {
        const at = stats.sessions.findIndex((r) => r.id === sessionIdRef.current);
        if (at !== -1) {
          const sessions = stats.sessions.slice();
          sessions[at] = { ...sessions[at]!, sideBet: { right: game.sideTally.right, wrong: game.sideTally.wrong, net: game.sideTally.net } };
          stats = { ...stats, sessions };
        }
      }
      rowKeyRef.current = key;
      if (final) endedRef.current = true;
      saveStats(stats);
    },
    [game, profileId, profileName, hotShoe],
  );

  /**
   * #42: write the bankroll back to the profile whenever an engine call has
   * moved it. To STORAGE ONLY: see playBankroll.ts for why the app's copy of
   * the profile is left alone (it keys the Table, and a remount would
   * reshuffle the shoe mid-session). Runs after every render, which is after
   * every engine call; the comparison makes the common case free.
   *
   * F1: only BETWEEN rounds, and in the same breath as the round's graded
   * events, so the stored bankroll and the stored stats always describe the
   * same rounds. An insurance loss mid-round is stored when the round settles.
   */
  const storedBankrollRef = useRef(game.bankroll);
  useEffect(() => {
    if (game.phase === 'player' || game.phase === 'insurance') return;
    persistSession(false);
    if (hotShoe) return;
    if (game.bankroll === storedBankrollRef.current) return;
    storedBankrollRef.current = game.bankroll;
    storeBankrollNow(profileId, game.bankroll);
  });

  const [overlay, setOverlay] = useState<OverlayInfo | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);

  /**
   * #36: the deal asked for, held while an owed count check is answered.
   * A ref, not state: it is read and cleared in the same handler that
   * submits the answer, and nothing renders from it.
   */
  const pendingDealRef = useRef<PendingDeal | null>(null);

  /**
   * Wave A: "Shuffling." has been said between rounds (as the cut-card round
   * settled, or as the count check owed on it was answered), so the deal that
   * shuffles does not say it a second time. Cleared by every deal.
   */
  const shuffleSaidRef = useRef(false);
  const settleAndNote = useCallback(() => {
    if (narrateSettlement(game, audio)) shuffleSaidRef.current = true;
  }, [game, audio]);

  /**
   * B2 #13 (R2): the round's wrong bet or play-or-sit decision, shown in the
   * strip until the next round is dealt. Training mode only, like the
   * wrong-play correction; never a modal.
   */
  const [betMiss, setBetMiss] = useState<(BetMiss & { round: number }) | null>(null);
  const noteBetMiss = useCallback(
    (fresh: readonly GradedEvent[]): void => {
      const miss = settings.feedbackMode === 'training' ? betMissFeedback(fresh) : null;
      setBetMiss(miss ? { ...miss, round: game.roundNo } : null);
      if (!miss) return;
      audio.ding('bad');
      audio.say(miss.spoken);
      // Wave J: the hand count a two-hand ramp called for, on its own.
      if (miss.spokenAfter) audio.say(miss.spokenAfter);
    },
    [game, audio, settings.feedbackMode],
  );

  /** Wave L: a wrong side-bet call, shown with its round, said after any bet miss. */
  const [sideMiss, setSideMiss] = useState<(SideMiss & { round: number }) | null>(null);
  const noteSideMiss = useCallback((): void => {
    const cfg = game.cfg.sideBet;
    const d = game.sideDecisionThisRound;
    const miss = cfg && d && settings.feedbackMode === 'training' ? sideMissFeedback(cfg, d) : null;
    setSideMiss(miss ? { ...miss, round: game.roundNo } : null);
    if (!miss) return;
    audio.ding('bad');
    audio.say(miss.spoken);
  }, [game, audio, settings.feedbackMode]);

  const runDeal = useCallback(
    (betUnits?: number | number[]) => {
      realignLosingShoe(playGame);
      const before = game.events.length;
      game.startRound(betUnits);
      // G2: the last round's dealer error went uncalled; the strip says so.
      if (game.missedDealerError) audio.ding('bad');
      // Said before the cards: it is about the bet just placed, and the cards
      // are what the next decision needs fresh.
      noteBetMiss(game.events.slice(before));
      noteSideMiss();
      narrateDeal(game, audio, shuffleSaidRef.current);
      shuffleSaidRef.current = false;
      settleAndNote(); // instant dealer-blackjack / all-naturals rounds settle inside startRound()
    },
    [game, playGame, audio, settleAndNote, noteBetMiss, noteSideMiss],
  );

  const runSitOut = useCallback(() => {
    // Wong-out: the engine plays the whole round (bots + dealer) synchronously,
    // so the shuffle line (if the shoe rolled over), the sit-out announcement,
    // and any settlement narration (dealer draws) all resolve in one pass --
    // exactly like an instant dealer-blackjack deal. No player cards to
    // narrate: the player was dealt none. R5.
    realignLosingShoe(playGame);
    const before = game.events.length;
    game.sitOut();
    if (game.missedDealerError) audio.ding('bad');
    if (game.shuffledLastRound && !shuffleSaidRef.current) audio.say(narrateShuffle());
    shuffleSaidRef.current = false;
    audio.say(narrateSitOut());
    noteBetMiss(game.events.slice(before));
    // Wave J: a round out is there to be COUNTED, so its opening cards are
    // read out as a round in's are (the bots' draws and the dealer's follow,
    // paced and at settlement).
    narrateDeal(game, audio, true);
    settleAndNote();
  }, [game, playGame, audio, settleAndNote, noteBetMiss]);

  /**
   * #36: if a count check is owed, ask it now -- on the way to the next
   * deal, with the settled hand still on the felt -- and hold the deal until
   * it is answered. Returns true when the deal must wait.
   */
  const poseCountCheckBeforeDeal = useCallback(
    (pending: PendingDeal): boolean => {
      if (!game.poseCountCheck()) return false;
      pendingDealRef.current = pending;
      audio.ding('attention');
      // #3: a true-count-only check opens on the true-count question.
      audio.say(narrateTableCountPrompt(game.askRc ? 'rc' : 'tc'));
      bump();
      return true;
    },
    [game, audio, bump],
  );

  const deal = useCallback(
    (betUnits?: number | number[]) => {
      if (poseCountCheckBeforeDeal({ kind: 'deal', bets: betUnits })) return;
      runDeal(betUnits);
      bump();
    },
    [poseCountCheckBeforeDeal, runDeal, bump],
  );

  const sitOut = useCallback(() => {
    if (poseCountCheckBeforeDeal({ kind: 'sitOut' })) return;
    runSitOut();
    bump();
  }, [poseCountCheckBeforeDeal, runSitOut, bump]);

  /**
   * Wave J toggle rework: flip the In/Out toggle. Nothing is dealt; the cue
   * says the new state, so eyes-free the next forward press is known.
   */
  const setIn = useCallback(
    (value: boolean) => {
      // The losing shoe's script is solo rounds: Out would add the bots a
      // watcher needs and eat its cards, so its toggle stays In -- and says
      // so, rather than swallowing a spoken "out" in silence (review N1).
      if (losingShoe) {
        audio.say(narrateInOut(true));
        return;
      }
      if (game.isIn === value) return;
      game.setIn(value);
      audio.say(narrateInOut(value));
      bump();
    },
    [game, audio, bump, losingShoe],
  );

  /** Wave L: set the side bet's chip; the cue says the new state, as the In/Out toggle's does. */
  const setSideOn = useCallback(
    (value: boolean) => {
      if (!game.cfg.sideBet) return;
      if (game.sideOn !== value) {
        game.setSideOn(value);
        bump();
      }
      audio.say(value ? SIDE_ON_LINE : SIDE_OFF_LINE);
    },
    [game, audio, bump],
  );

  const insure = useCallback(
    (take: boolean) => {
      game.insuranceDecision(take);
      settleAndNote();
      bump();
    },
    [game, bump, settleAndNote],
  );

  const act = useCallback(
    (action: Action, timing?: DecisionTiming) => {
      const before = game.events.length;
      // Snapshot BEFORE the engine mutates the hand -- see OverlayInfo.cards.
      const gradedHand = game.hands[game.active];
      const gradedCards = gradedHand ? [...gradedHand.cards] : undefined;
      const gradedUp = game.dealerCards[0]?.rank;
      const gradedCanSplit = game.legalActions().includes('split');
      game.act(action, timing);
      if (timing?.paced) pacedRef.current += 1;
      const newEvents = game.events.slice(before);
      if (settings.feedbackMode === 'training') {
        const actionEvent = newEvents.find((e) => e.kind === 'action');
        if (actionEvent) {
          audio.say(narrateCorrection(actionEvent));
          audio.ding(actionEvent.correct ? 'good' : 'bad');
        }
        const wrong = newEvents.find((e) => e.kind === 'action' && !e.correct);
        if (wrong) {
          setOverlay({
            taken: action,
            expected: wrong.expected,
            reason: wrong.reason,
            tc: wrong.tc,
            hand: wrong.hand,
            classification: wrong.classification,
            cards: gradedCards,
            dealerUp: gradedUp,
            canSplit: gradedCanSplit,
          });
        }
      }
      settleAndNote();
      bump();
    },
    [game, bump, settings.feedbackMode, audio, settleAndNote],
  );

  const dismissOverlay = useCallback(() => setOverlay(null), []);

  /**
   * G2 (L-8): call Foul on the settled round's payout. The engine grades it
   * and, on a real error, corrects the payout; the bankroll and session row
   * follow on the render this bump causes.
   */
  const callFoul = useCallback(() => {
    const verdict = game.callFoul();
    if (!verdict) return;
    audio.ding(verdict.correct ? 'good' : 'bad');
    bump();
  }, [game, audio, bump]);

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

  /**
   * Table Realism (Request B): mirrors the bot-narration pacing effect
   * immediately above, but as a single duration timer (not a per-tick
   * chain) since the opening deal's stagger itself lives entirely in CSS
   * (`--deal-i` * `--deal-speed`, see PlayingCard.tsx/app.css) -- this state
   * exists ONLY to know how long to keep offering a skip control, never to
   * gate what's rendered. See the `prefersReducedMotion`/`dealAnimating`
   * doc comment above for why this can never desync grading or the count.
   */
  const [dealAnimating, setDealAnimating] = useState(false);
  const dealAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dealOrderRef = useRef<typeof game.dealOrder>(game.dealOrder);

  const clearDealAnimTimer = useCallback(() => {
    if (dealAnimTimerRef.current !== null) {
      clearTimeout(dealAnimTimerRef.current);
      dealAnimTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    // A new round always reassigns `dealOrder` to a fresh array (see
    // beginRound()), so a reference change is exactly "a new round just
    // dealt" -- an in-place mutation (there is none for dealOrder; it's
    // write-once per round) would never trip this.
    if (game.dealOrder === dealOrderRef.current) return;
    dealOrderRef.current = game.dealOrder;
    clearDealAnimTimer();

    if (game.dealOrder.length === 0 || prefersReducedMotion()) {
      setDealAnimating(false);
      return;
    }
    setDealAnimating(true);
    // +40ms slack over the exact CSS timeline so the skip control never
    // disappears a frame before the LAST card has actually settled.
    const totalMs = (game.dealOrder.length - 1) * settings.dealSpeedMs + DEAL_ENTRANCE_MS + 40;
    dealAnimTimerRef.current = setTimeout(() => {
      dealAnimTimerRef.current = null;
      setDealAnimating(false);
    }, totalMs);
  }, [game, game.dealOrder, settings.dealSpeedMs, clearDealAnimTimer]);

  // Unmount-only cleanup so no timer outlives the component.
  useEffect(() => clearDealAnimTimer, [clearDealAnimTimer]);

  const skipDeal = useCallback(() => {
    clearDealAnimTimer();
    setDealAnimating(false);
  }, [clearDealAnimTimer]);

  /**
   * The player asked to end the session. Returns true when it may end now;
   * false when a count check was owed, which is posed instead -- the caller
   * ends the session once `submitCount` reports the answer released it.
   */
  const requestEnd = useCallback(
    (): boolean => !poseCountCheckBeforeDeal({ kind: 'end' }),
    [poseCountCheckBeforeDeal],
  );

  /** Grade the count check. `endNow` is true when the answer released an End
   * that was waiting on it (see `requestEnd`): the caller ends the session.
   * `check` is the verdict, for the screen to show -- the spoken answer alone
   * left a muted player never knowing what the count was. */
  const submitCount = useCallback(
    (rc: number | null, tcGuess?: number): { endNow: boolean; check: CountCheckVerdict } => {
      const result = game.submitCountCheck(rc, tcGuess);
      const roundAtCheck = game.roundNo;
      if (result.rcCorrect !== undefined) {
        audio.say(narrateCountAnswer(result.actualRc));
        audio.ding(result.rcCorrect ? 'good' : 'bad');
      } else if (result.actualTc !== undefined) {
        // #3: a true-count-only check answers with the true count.
        audio.say(narrateCountAnswer(result.actualTc));
        audio.ding(result.tcCorrect ? 'good' : 'bad');
      }
      // F1: the answer is graded now; commit it before the next deal starts
      // a round whose events wait for its settle.
      persistSession(false);
      // #36: the deal that was asked for happens right after the answer.
      const pending = pendingDealRef.current;
      pendingDealRef.current = null;
      const next = pending?.kind === 'deal' || pending?.kind === 'sitOut';
      // Wave A: the round just counted reached the cut card. Its shuffle was
      // held back so as not to tell the player the count was 0 before the
      // check (narrateSettlement); the check is answered, so say it now.
      const shuffling = next && game.shuffleDue;
      if (shuffling) {
        sayShuffleBetweenRounds(game, audio);
        shuffleSaidRef.current = true;
      }
      // With a spread on, the bet (or the sit-out) was chosen before the
      // player knew the next hand is off a fresh shoe at count 0 -- and it is
      // graded at that count (s06). So the deal waits for a bet placed with
      // the cut card on screen, instead of running the stale one.
      const holdForBet = shuffling && game.cfg.betSpreadOn;
      if (!holdForBet) {
        if (pending?.kind === 'deal') runDeal(pending.bets);
        else if (pending?.kind === 'sitOut') runSitOut();
      }
      bump();
      return { endNow: pending?.kind === 'end', check: { ...result, rcGuess: rc, tcGuess, round: roundAtCheck + 1 } };
    },
    [game, bump, audio, runDeal, runSitOut, persistSession],
  );

  /**
   * End the session. Returns null when nothing was played (F22): no rounds,
   * no report, and no session row. Otherwise commits whatever is still
   * uncommitted (a round ended mid-play) and finalises this session's row --
   * the one the settled rounds have been keeping current (R1), never a second.
   */
  const endSession = useCallback((): SessionReport | null => {
    if (game.roundNo === 0) return null;
    // G2: no deal follows End, so an error still uncalled is missed now.
    game.closeDealerError();
    persistSession(true);
    const events = game.events;
    const bankrollDelta = game.bankroll - game.cfg.bankrollStart;
    storedBankrollRef.current = game.bankroll;
    if (!hotShoe) storeBankrollNow(profileId, game.bankroll);
    const rep = {
      ...buildReport(events, bankrollDelta, peeksRef.current, game.handsPlayed),
      hotShoe,
      pacedDecisions: pacedRef.current,
      dealerErrors: sessionDealerErrors(game.dealerErrorTally, game.dealerMistakesUsed).dealerErrors ?? null,
      dealerMistakesTraining: game.dealerMistakesTrainingUsed,
    };
    setReport(rep);
    return rep;
  }, [game, profileId, persistSession, hotShoe]);

  return {
    game,
    losingShoe,
    hotShoe,
    deal,
    sitOut,
    setIn,
    act,
    insure,
    callFoul,
    submitCount,
    requestEnd,
    overlay,
    dismissOverlay,
    report,
    endSession,
    notePeek,
    betMiss,
    sideMiss,
    setSideOn,
    botNarrationRevealed,
    fastForwardNarration,
    dealAnimating,
    skipDeal,
  };
}
