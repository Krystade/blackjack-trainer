import type { NextStepKind } from './screens/nextStep';
import type { CustomSelection, Settings } from '../store/types';
import { ALL_PAINT_CELL_IDS, DEFAULT_MIX } from '../drills/cellSelection';
import { saveSettings } from '../store/persist';
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
 * Contract 4 (Wave B, B6): "Drill these hands" on the session report opens
 * Custom on exactly the report's missed cells. Every chart cell is marked
 * painted, so the Auto fill a Custom launch applies (autoTiers leaves painted
 * cells alone) keeps the missed cells Focus and every other cell Off. The
 * existing mix and favour-missed toggle are kept. Pure.
 */
export function customCellsSettings(cellIds: readonly string[], settings: Settings): Settings {
  const prev = settings.drill.custom;
  const tiers: CustomSelection['tiers'] = {};
  for (const id of cellIds) tiers[id] = 'focus';
  const painted: Record<string, true> = {};
  for (const id of ALL_PAINT_CELL_IDS) painted[id] = true;
  for (const id of cellIds) painted[id] = true;
  const custom: CustomSelection = {
    tiers,
    painted,
    mix: prev ? { ...prev.mix } : { ...DEFAULT_MIX },
    favourMissed: prev?.favourMissed ?? false,
  };
  return { ...settings, drill: { ...settings.drill, custom } };
}

/** Contract 4: persist the Custom selection and hand 'custom' to the next Drills mount. */
export function launchCustomCells(cellIds: readonly string[], settings: Settings): Settings {
  const next = customCellsSettings(cellIds, settings);
  saveSettings(next);
  setDrillLaunch('custom');
  return next;
}

/**
 * B2 "Review N due" (controller ruling): the due cells, handed to the next
 * Flashcards mount in memory only -- never persisted, never replayed on
 * reload, and never written into the saved Custom deck. Drills takes it
 * (which clears it) and Flashcards deals only these cells for that session.
 *
 * Wave B2 R5 (#46): "Drill these hands" hands the report's missed cells over
 * the same way, as a 'session' deck, so the saved Custom deck is untouched.
 * R7: either is a finite session -- a cell leaves it once answered right.
 */
export type FlashHandOverSource = 'review' | 'session';
export interface FlashHandOver {
  ids: string[];
  source: FlashHandOverSource;
}

let flashHandOver: FlashHandOver | null = null;

export function setReviewDeck(cellIds: readonly string[], source: FlashHandOverSource = 'review'): void {
  flashHandOver = { ids: [...cellIds], source };
}

/** The pending Flashcards hand-over, cleared as it is read. */
export function takeFlashHandOver(): FlashHandOver | null {
  const h = flashHandOver;
  flashHandOver = null;
  return h;
}

/** The pending deck's cells, cleared as they are read. */
export function takeReviewDeck(): string[] | null {
  return takeFlashHandOver()?.ids ?? null;
}

/**
 * B2: Review's Start. Hands the due cells over and returns the settings
 * unchanged (the same object), so Home saves nothing and the user's Custom
 * deck, scopes and deck choice all survive the review. Pair with
 * setDrillLaunch('flash').
 */
export function reviewLaunch(settings: Settings, cellIds: readonly string[]): Settings {
  setReviewDeck(cellIds, 'review');
  return settings;
}

/**
 * Wave B2 #38 / R7: the due INDEXES of an index review, handed to the next
 * Deviation quiz mount in memory, exactly as the cells are. The quiz asks only
 * these, ignoring (and never rewriting) the saved Index choice.
 */
let reviewIndexes: string[] | null = null;

export function setReviewIndexes(ids: readonly string[]): void {
  reviewIndexes = [...ids];
}

/** The pending index review, cleared as it is read. */
export function takeReviewIndexes(): string[] | null {
  const r = reviewIndexes;
  reviewIndexes = null;
  return r;
}

/** R7: an index review's Start. Settings come back unchanged; pair with setDrillLaunch('quiz'). */
export function reviewIndexesLaunch(settings: Settings, ids: readonly string[]): Settings {
  setReviewIndexes(ids);
  return settings;
}
