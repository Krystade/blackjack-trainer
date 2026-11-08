/**
 * T2-2A: the count drill's pace ramp. Easy first run deals at 2 s a card; the
 * step that counts ("Running count at table pace") needs a deck in 30 s,
 * 576 ms a card. Rather than leave a beginner to find their own way across
 * that gap, the ramp deals at five steps and moves up one only once accuracy
 * holds at the current one -- the same accuracy gate the Timed Challenge uses
 * (competenceGate.ts computeUnlockedTier, R2: advancing on a schedule
 * inflates in-drill scores without improving retained skill).
 *
 * Derived, never stored: the step is read off the count-drill history each
 * time, so nothing is written behind the user's back. While the ramp is on
 * (Settings.drill.countPaceRamp) a visual auto run deals at the step's pace;
 * countIntervalMs -- also the eyes-free gap and Produce TC's pace -- is never
 * touched. Pure: no clock, no storage.
 */
import { computeUnlockedTier } from './competenceGate';
import type { GateResult } from './competenceGate';
import { RAMP_FLOOR_MS, TABLE_PACE_MS, countRunPerCardMs, rampIntervalMs } from './countSpeed';
import { FLUENCY_MIN_CARDS } from './fluencyGate';
import type { CountRunLike } from './fluencyGate';
import { EASY_INTERVAL_MS } from './hiLoAid';

/** The decay that takes Easy first run's 2000 ms to table pace in four steps. */
export const PACE_RAMP_DECAY = Math.pow(TABLE_PACE_MS / EASY_INTERVAL_MS, 1 / 4);

/**
 * The geometric ramp from Easy first run to table pace (rampIntervalMs, no
 * floor in the way), rounded to the stepper's 100 ms grid, with the last step
 * taken down to the largest multiple of 50 at or under TABLE_PACE_MS -- so
 * the top step really is table pace. 2000, 1500, 1100, 800, 550.
 */
export function derivePaceSteps(): number[] {
  const steps = [0, 1, 2, 3, 4].map((i) =>
    Math.round(rampIntervalMs(i, EASY_INTERVAL_MS, { decay: PACE_RAMP_DECAY, floorMs: 0 }) / 100) * 100,
  );
  steps[4] = Math.floor(TABLE_PACE_MS / 50) * 50;
  return steps;
}

/** Slowest first. Pinned to derivePaceSteps() by a test. */
export const PACE_STEPS_MS = [2000, 1500, 1100, 800, 550] as const;
export const PACE_STEP_COUNT = PACE_STEPS_MS.length;

type StepId = 's1' | 's2' | 's3' | 's4' | 's5';
const STEP_IDS: readonly StepId[] = ['s1', 's2', 's3', 's4', 's5'];

/**
 * The gate: a step is held at 80% over its last 5 runs, with at least 3 --
 * 3 of 3 right, or 4 of the last 5. Three misses in a row ease one step.
 */
const RAMP_GATE = { windowSize: 5, minAttempts: 3, advanceThresholdPct: 80, order: STEP_IDS } as const;

/**
 * The step (0-based) a run at `perCardMs` attempted: the fastest step at
 * least as slow as the run. Conservative -- a 1300 ms run is credited to the
 * 1500 step, anything slower than 2000 to the first, anything at 550 or
 * faster to the top.
 */
export function stepOfPace(perCardMs: number): number {
  for (let i = PACE_STEP_COUNT - 1; i >= 0; i--) {
    if (PACE_STEPS_MS[i]! >= perCardMs) return i;
  }
  return 0;
}

/**
 * The runs the ramp judges: graded, set-pace, visual deck runs. Manual runs
 * (no set pace), self-reports (not graded), short runs and eyes-free runs
 * (their pace is speech plus the gap, which the ramp does not set) are left
 * out.
 */
export function rampHistory(history: readonly CountRunLike[]): { tier: StepId; correct: boolean }[] {
  const out: { tier: StepId; correct: boolean }[] = [];
  for (const run of history) {
    if (run.manual === true || run.selfReport === true || run.eyesFree === true) continue;
    if (run.cards < FLUENCY_MIN_CARDS) continue;
    const perCard = countRunPerCardMs(run);
    if (typeof perCard !== 'number' || perCard <= 0) continue;
    out.push({ tier: STEP_IDS[stepOfPace(perCard)]!, correct: run.correct });
  }
  return out;
}

export interface PaceRampStatus {
  /** 0-based step index. */
  index: number;
  /** 1-based, for display: "step 3 of 5". */
  step: number;
  /** Per-card ms the step deals at. */
  ms: number;
  /** Runs judged at this step (its last 5) and how many were right. */
  judged: number;
  right: number;
  /** The next step and the fewest further right runs that unlock it; null at the top. */
  next: { ms: number; need: number } | null;
}

function gateOf(ramp: readonly { tier: StepId; correct: boolean }[]): GateResult<StepId> {
  return computeUnlockedTier(ramp, RAMP_GATE);
}

export function paceRampStatus(history: readonly CountRunLike[]): PaceRampStatus {
  const ramp = rampHistory(history);
  const tier = gateOf(ramp).unlockedTier;
  const index = STEP_IDS.indexOf(tier);
  const window = ramp.filter((r) => r.tier === tier).slice(-RAMP_GATE.windowSize);
  let next: PaceRampStatus['next'] = null;
  if (index < PACE_STEP_COUNT - 1) {
    // Asked of the gate itself, so the copy can never promise what it won't do.
    let need: number = RAMP_GATE.windowSize;
    for (let k = 1; k <= RAMP_GATE.windowSize; k++) {
      const more = [...ramp, ...Array.from({ length: k }, () => ({ tier, correct: true }))];
      if (STEP_IDS.indexOf(gateOf(more).unlockedTier) > index) {
        need = k;
        break;
      }
    }
    next = { ms: PACE_STEPS_MS[index + 1]!, need };
  }
  return {
    index,
    step: index + 1,
    ms: PACE_STEPS_MS[index]!,
    judged: window.length,
    right: window.filter((r) => r.correct).length,
    next,
  };
}

/**
 * The interval the flash timer runs at for a ramp run: the step's per-card
 * pace times the group, since the timer runs once per group -- so a grouped
 * run is dealt at the step's pace a card too. A table run's timer is already
 * per card, and Countdown deals single cards.
 */
export function rampDealMs(status: Pick<PaceRampStatus, 'ms'>, group: 2 | 3 | undefined): number {
  return Math.max(RAMP_FLOOR_MS, status.ms * (group ?? 1));
}

function runsWord(n: number): string {
  return n === 1 ? '1 more right run' : `${n} more right runs`;
}

/** The setup screen's line: where you are, and what unlocks the next step. */
export function rampSetupLine(status: PaceRampStatus): string {
  const head = `Pace step ${status.step} of ${PACE_STEP_COUNT} · ${status.ms} ms a card`;
  if (!status.next) return `${head}: table pace. Deck runs at this pace count toward the step.`;
  return `${head}. ${runsWord(status.next.need)} at this pace ${status.next.need === 1 ? 'unlocks' : 'unlock'} ${status.next.ms} ms.`;
}

export type RampChange = 'advanced' | 'eased' | 'held';

export function rampChange(before: PaceRampStatus, after: PaceRampStatus): RampChange {
  if (after.index > before.index) return 'advanced';
  if (after.index < before.index) return 'eased';
  return 'held';
}

/** The result screen's line, after a ramp run. */
export function rampResultLine(before: PaceRampStatus, after: PaceRampStatus): string {
  switch (rampChange(before, after)) {
    case 'advanced':
      return `Pace up: the next run deals at ${after.ms} ms a card (step ${after.step} of ${PACE_STEP_COUNT}).`;
    case 'eased':
      return `Eased back to ${after.ms} ms a card after three misses in a row.`;
    default:
      return after.next
        ? `${after.ms} ms a card: ${runsWord(after.next.need)} ${after.next.need === 1 ? 'unlocks' : 'unlock'} ${after.next.ms} ms.`
        : `Table pace: step ${after.step} of ${PACE_STEP_COUNT}.`;
  }
}
