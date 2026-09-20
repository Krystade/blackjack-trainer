/**
 * A field-test run that navigation cannot throw away.
 *
 * THE BUG THIS FIXES, in the operator's words after the first real run
 * (2026-09-19): "Can't have to go back and forth and have it reset all
 * progress." The protocol lived entirely inside the Settings screen's React
 * state, so the ticks recording which steps were done existed only while that
 * screen was mounted -- and the steps themselves REQUIRE leaving it, because
 * you cannot hear a drill speak from the settings page. Every step therefore
 * destroyed the record of the step before it. Four steps in, the run was
 * abandoned, and the log from it has no stamps at all past the second.
 *
 * So the run lives here: module state, mirrored to localStorage on every
 * change, published to whoever is rendering it. Navigating is free, the app
 * can be reloaded mid-run by the update check, and the run is still there.
 *
 * PERSISTED, unlike the voice toggle next door, and the difference is worth
 * stating because the rule there is the opposite. A microphone that reopened
 * itself on launch because of yesterday would be a privacy failure; a
 * checklist that is still on step 5 tomorrow is just a checklist. Nothing
 * here opens a microphone -- the panel does that, per step, from a tap.
 */

import { DEFAULT_FIELD_TEST_CONDITION, FIELD_TEST_STEPS } from './fieldTest';

const STORAGE_KEY = 'bjtrainer.fieldTestRun.v1';

export interface FieldTestRun {
  /** Whether the floating panel should be up. */
  active: boolean;
  /** Which route this run is measuring. Rides on every stamp. */
  condition: string;
  /** Where in FIELD_TEST_STEPS the operator is. */
  stepIndex: number;
  /** How many times each step has been stamped, by step id. */
  stamps: Record<string, number>;
}

export const IDLE_RUN: FieldTestRun = {
  active: false,
  condition: DEFAULT_FIELD_TEST_CONDITION,
  stepIndex: 0,
  stamps: {},
};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce whatever is in storage into a usable run.
 *
 * Defensive because the step list changes between releases: a run saved when
 * there were ten steps must not leave a reloaded app pointing at step 10 of
 * 9 and rendering nothing at all, which from the car is the panel having
 * vanished.
 */
function coerce(raw: unknown): FieldTestRun {
  if (typeof raw !== 'object' || raw === null) return { ...IDLE_RUN };
  const r = raw as Partial<FieldTestRun>;
  const stamps: Record<string, number> = {};
  if (typeof r.stamps === 'object' && r.stamps !== null) {
    for (const [k, v] of Object.entries(r.stamps)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) stamps[k] = Math.floor(v);
    }
  }
  const index =
    typeof r.stepIndex === 'number' && Number.isFinite(r.stepIndex) ? Math.floor(r.stepIndex) : 0;
  return {
    active: r.active === true,
    condition: typeof r.condition === 'string' ? r.condition : DEFAULT_FIELD_TEST_CONDITION,
    stepIndex: Math.min(Math.max(index, 0), FIELD_TEST_STEPS.length - 1),
    stamps,
  };
}

let run: FieldTestRun | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a subscriber must never take the run down with it */
    }
  }
}

function write(next: FieldTestRun): void {
  run = next;
  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Out of quota, or private mode. The run continues in memory; losing it
      // on reload is far better than losing it on the next navigation, which
      // is the failure actually being fixed here.
    }
  }
  notify();
}

export function readFieldTestRun(): FieldTestRun {
  if (run) return run;
  const s = storage();
  if (!s) {
    run = { ...IDLE_RUN };
    return run;
  }
  try {
    const raw = s.getItem(STORAGE_KEY);
    run = raw ? coerce(JSON.parse(raw)) : { ...IDLE_RUN };
  } catch {
    run = { ...IDLE_RUN };
  }
  return run;
}

export function subscribeFieldTestRun(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Begin a run under `condition`, from step one, with no stamps.
 *
 * Starting clears the previous run's ticks rather than resuming it: the same
 * step under a different route is a different measurement, and a tick carried
 * across reads as already done when it is not.
 */
export function startFieldTestRun(condition: string): void {
  write({ active: true, condition, stepIndex: 0, stamps: {} });
}

export function stopFieldTestRun(): void {
  write({ ...readFieldTestRun(), active: false });
}

/** Switch route mid-run. Clears the ticks, for the reason above. */
export function setFieldTestCondition(condition: string): void {
  write({ ...readFieldTestRun(), condition, stepIndex: 0, stamps: {} });
}

export function goToFieldTestStep(index: number): void {
  const clamped = Math.min(Math.max(index, 0), FIELD_TEST_STEPS.length - 1);
  write({ ...readFieldTestRun(), stepIndex: clamped });
}

/**
 * Record that a step was stamped, and how many times.
 *
 * The count is not the record -- the diagnostic log is -- it is there so a
 * step done at a red light is visibly done when you next look at the screen,
 * and so a double-tap is visibly two rather than silently one.
 */
export function markFieldTestStamped(stepId: string): void {
  const current = readFieldTestRun();
  write({
    ...current,
    stamps: { ...current.stamps, [stepId]: (current.stamps[stepId] ?? 0) + 1 },
  });
}

/** Test-only: forget the run and every subscriber. */
export function _resetFieldTestRunForTest(): void {
  run = null;
  listeners.clear();
  const s = storage();
  try {
    s?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
