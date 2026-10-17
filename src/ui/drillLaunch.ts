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
