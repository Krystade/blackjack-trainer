import type { Settings } from '../store/types';

/**
 * C-R3 (W10): Home's "Drive: <drill>" button -- one tap back into the last
 * drill that was run eyes-free or by voice, eyes-free on and already going.
 *
 * Only the drills that have an eyes-free mode can be driven, named as the
 * Drills picker names them.
 */
export const DRIVE_LABELS = {
  flash: 'Flashcards',
  quiz: 'Deviation quiz',
  mixed: 'Mixed',
  count: 'Count drill',
  truecount: 'True count drill',
  producetc: 'Produce the true count',
  // H3: the two wheel-answered yes/no drills (C-R1) run eyes-free too.
  speed: 'Speed',
  betsizing: 'Bet sizing',
} as const;

/**
 * H3: drills with an eyes-free mode but no microphone. Only eyes-free makes
 * one a Drive drill, and it is remembered with the voice off: Drive restores
 * the microphone as it was, and these never had it.
 */
const NO_VOICE: ReadonlySet<DriveMode> = new Set<DriveMode>(['speed', 'betsizing']);

export type DriveMode = keyof typeof DRIVE_LABELS;

function isDriveMode(mode: unknown): mode is DriveMode {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(DRIVE_LABELS, mode);
}

export interface DriveTarget {
  mode: DriveMode;
  voice: boolean;
  label: string;
}

/** The drill Drive reopens, or null when there is none (no button). */
export function driveTarget(settings: Settings): DriveTarget | null {
  const last = settings.lastDrive as unknown;
  if (typeof last !== 'object' || last === null) return null;
  const { mode, voice } = last as { mode?: unknown; voice?: unknown };
  if (!isDriveMode(mode)) return null;
  return { mode, voice: voice === true, label: DRIVE_LABELS[mode] };
}

/**
 * Remember `mode` as the last eyes-free / voice drill (`eyesFree` says which
 * of the two it was run with; voice alone does not drive a drill with no
 * microphone). Returns the SAME
 * object when nothing changes (or the drill cannot be driven), so a caller
 * can skip the save.
 */
export function recordDrive(settings: Settings, mode: string, voice: boolean, eyesFree = true): Settings {
  if (!isDriveMode(mode)) return settings;
  if (NO_VOICE.has(mode)) {
    if (!eyesFree) return settings;
    voice = false;
  }
  const last = settings.lastDrive;
  if (last && last.mode === mode && last.voice === voice) return settings;
  return { ...settings, lastDrive: { mode, voice } };
}

/**
 * The drill opened by Drive starts itself: a count drill would otherwise sit
 * on its setup screen waiting for a second tap the driver should not make.
 * In memory, for the very next mount, like setDrillLaunch.
 */
let autoStart = false;

export function setDriveAutoStart(): void {
  autoStart = true;
}

export function takeDriveAutoStart(): boolean {
  const a = autoStart;
  autoStart = false;
  return a;
}
