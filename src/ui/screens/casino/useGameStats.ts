import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { loadGameCache, pruneGameResults, subscribeGameResults, type GameResult } from '../../../store/casinoGameStats';
import { getActiveProfile } from '../../../store/profiles';
import type { CasinoLog, GeoPoint } from '../../../store/casinoLog';
import type { Profile } from '../../../store/types';
import { runnerState, subscribeRunner, type RunnerState } from './simRunner';

export interface GameCache {
  results: Record<string, GameResult>;
  /** Wave Q: results by key for inputs no game has now (casinoGameStats.ts). */
  archive: Record<string, GameResult>;
}

/** Cached results, re-read whenever one is saved (here or in another tab). */
export function useGameCache(log: CasinoLog): GameCache {
  const [cache, setCache] = useState(() => loadGameCache());
  useEffect(() => subscribeGameResults(() => setCache(loadGameCache())), []);
  // Results for games that are gone go to the archive.
  const ids = useMemo(() => new Set(log.casinos.flatMap((c) => c.games.map((g) => g.id))), [log]);
  useEffect(() => {
    if (ids.size > 0) pruneGameResults(ids);
  }, [ids]);
  return cache;
}

export function useRunner(): RunnerState {
  return useSyncExternalStore(subscribeRunner, runnerState, runnerState);
}

/** The active Play profile, read when the Casino tab renders (profiles change on another tab). */
export function useActiveProfile(): Profile {
  return useMemo(() => getActiveProfile(), []);
}

const USE_LOCATION_KEY = 'bjtrainer.casinoUseLocation.v1';

function readUseLocation(): boolean {
  try {
    return localStorage.getItem(USE_LOCATION_KEY) === '1';
  } catch {
    return false;
  }
}

function writeUseLocation(on: boolean): void {
  try {
    if (on) localStorage.setItem(USE_LOCATION_KEY, '1');
    else localStorage.removeItem(USE_LOCATION_KEY);
  } catch {
    /* a per-device convenience: losing it costs one tap */
  }
}

export type HereState = { on: boolean; here: GeoPoint | null; status: 'off' | 'locating' | 'ok' | 'denied' | 'unavailable' };

/**
 * "Use my location" for the ranking. The phone's position is asked for ONLY
 * on a tap of the toggle; with the choice remembered from an earlier visit it
 * is fetched again only when the browser already holds the permission (so a
 * page load never raises the prompt). The position is never stored.
 */
export function useHere(): { state: HereState; toggle: () => void } {
  const [state, setState] = useState<HereState>(() => ({ on: readUseLocation(), here: null, status: 'off' }));

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, status: 'unavailable' }));
      return;
    }
    setState((s) => ({ ...s, status: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setState((s) => (s.on ? { ...s, here: { lat: pos.coords.latitude, lon: pos.coords.longitude }, status: 'ok' } : s)),
      (err) => setState((s) => ({ ...s, here: null, status: err.code === 1 ? 'denied' : 'unavailable' })),
      { maximumAge: 5 * 60_000, timeout: 15_000 },
    );
  }, []);

  useEffect(() => {
    if (!state.on) return;
    let cancelled = false;
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms?.query) return;
    perms
      .query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === 'granted') locate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only on mount: a toggle tap locates directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    const on = !state.on;
    writeUseLocation(on);
    setState({ on, here: null, status: on ? 'locating' : 'off' });
    if (on) locate();
  }, [state.on, locate]);

  return { state, toggle };
}
