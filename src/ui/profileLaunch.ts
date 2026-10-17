import type { Screen } from './App';

/**
 * A one-shot hand-off into the profile editor: Play's gear sheet opens the
 * active profile at its bet ramp and comes back to Play on Save or Cancel.
 * Read once by ProfileEditor on mount, and cleared as read.
 */
export interface ProfileLaunch {
  section: 'ramp';
  returnTo: Screen;
}

let pending: ProfileLaunch | null = null;

export function setProfileLaunch(l: ProfileLaunch): void {
  pending = l;
}

export function takeProfileLaunch(): ProfileLaunch | null {
  const l = pending;
  pending = null;
  return l;
}
