import { createContext, useContext } from 'react';
import type { Screen } from './App';
import type { Profile, Settings } from '../store/types';

/**
 * What a tab's gear sheet (#33) needs from the app shell.
 *
 * A context rather than props because the gear is placed inside screens that
 * other work owns (Table, Drills, Charts), with only `tab` passed in. The app
 * shell is the one place that holds the live Settings and the active profile,
 * so it provides them here, and a sheet edits exactly those objects.
 */
export interface TabSettingsContextValue {
  settings: Settings;
  /** Persist and publish a whole new Settings object (as the Settings screen does). */
  commitSettings: (next: Settings) => void;
  activeProfile: Profile;
  /**
   * Write `patch` to the active profile in storage (null: write nothing, a
   * reset already did), then refresh the shell's copy. On Play that copy keys
   * the Table, so this deals a new table: see App.tsx.
   */
  applyProfile: (patch: Partial<Profile> | null) => void;
  navigate: (screen: Screen) => void;
}

export const TabSettingsContext = createContext<TabSettingsContextValue | null>(null);

export function useTabSettings(): TabSettingsContextValue | null {
  return useContext(TabSettingsContext);
}
