import type { NextStepKind } from './screens/nextStep';
import type { Settings } from '../store/types';
import type { HandScope } from '../drills/handScope';
import { ALL_SCOPES, withScopes } from '../drills/handScope';

/**
 * #28: a drill Home asked Drills to open, handed across one navigation.
 * In memory only: it is an instruction for the very next mount of Drills,
 * not something a reload should replay. Drills takes it (which clears it)
 * when it mounts; 'custom' means Custom with the Auto fill applied.
 */
export type DrillLaunch = Exclude<NextStepKind, 'play'>;

let pending: DrillLaunch | null = null;

export function setDrillLaunch(mode: DrillLaunch): void {
  pending = mode;
}

/** The pending launch, cleared as it is read. */
export function takeDrillLaunch(): DrillLaunch | null {
  const m = pending;
  pending = null;
  return m;
}

/**
 * F21 / s07: the drill settings a Home launch should run with, written BEFORE
 * Drills mounts (Home persists them and lifts them into App), so the drill
 * opens on what Next step named:
 *
 * - 'flash' deals the chart (never a leftover Custom / Marked / Indexes deck)
 *   on the step's hand type, or on every hand type when it names none.
 * - 'mastery' sweeps the whole chart: a sweep only counts as Home's step when
 *   every cell is in it, so a leftover Custom deck would make the step
 *   impossible to finish from its own Start button.
 * - Anything else leaves the settings as they are (Custom applies Auto
 *   itself; the quiz and the count drill have no hand deck).
 */
export function launchSettings(mode: DrillLaunch, scope: HandScope | undefined, settings: Settings): Settings {
  if (mode !== 'flash' && mode !== 'mastery') return settings;
  const scopes = mode === 'flash' && scope ? [scope] : [...ALL_SCOPES];
  const scoped = withScopes(settings, scopes);
  return { ...scoped, drill: { ...scoped.drill, deck: 'chart' } };
}

/**
 * B2 "Review N due" (controller ruling): the due cells, handed to the next
 * Flashcards mount in memory only -- never persisted, never replayed on
 * reload, and never written into the saved Custom deck. Flashcards takes it
 * (which clears it) and deals only these cells for that session.
 */
let reviewDeck: string[] | null = null;

export function setReviewDeck(cellIds: readonly string[]): void {
  reviewDeck = [...cellIds];
}

/** The pending review deck, cleared as it is read. */
export function takeReviewDeck(): string[] | null {
  const d = reviewDeck;
  reviewDeck = null;
  return d;
}

/**
 * B2: Review's Start. Hands the due cells over and returns the settings
 * unchanged (the same object), so Home saves nothing and the user's Custom
 * deck, scopes and deck choice all survive the review. Pair with
 * setDrillLaunch('flash').
 */
export function reviewLaunch(settings: Settings, cellIds: readonly string[]): Settings {
  setReviewDeck(cellIds);
  return settings;
}
