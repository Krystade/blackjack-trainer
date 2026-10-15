import type { NextStepKind } from './screens/nextStep';

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
