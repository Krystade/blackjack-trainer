import {
  currentVersionId,
  isHouseGame,
  earlierVersions,
  gameAtVersion,
  sessionsAtGameVersion,
  versionsOf,
  type Casino,
  type CasinoGame,
  type CasinoLog,
  type CasinoSession,
  type GameVersion,
} from '../store/casinoLog';
import { resultForKey, simInputFor, type GameResult } from '../store/casinoGameStats';
import type { Profile } from '../store/types';
import { localDateKey, longDate } from './casinoFigures';
import { ruleLines, sideBetText } from './casinoDirectory';

/**
 * Wave W (review S2): what the screens say about a game's versions -- what
 * a save would change, whether the version it changes holds anything worth
 * keeping, and each version's span and sessions.
 */

/** Rule lines that are the game's own, not its version's (casinoLog.ts VERSIONED_FIELDS). */
const NOT_VERSIONED = new Set(['roundsPerHour', 'variantName']);

/** "Late surrender: Yes → No", for every versioned rule a save changes; the side bets as one line. */
export function ruleChanges(prev: CasinoGame, next: CasinoGame): string[] {
  const before = new Map(ruleLines(prev).map((l) => [l.field, l]));
  const out: string[] = [];
  for (const l of ruleLines(next)) {
    if (NOT_VERSIONED.has(l.field)) continue;
    const was = before.get(l.field);
    if (!was || was.value === l.value) continue;
    out.push(`${l.label}: ${was.value ?? 'not logged'} → ${l.value ?? 'not logged'}`);
  }
  const sides = (g: CasinoGame) => (g.sideBets ?? []).map(sideBetText).join(', ') || 'none';
  if (sides(prev) !== sides(next)) out.push(`Side bets: ${sides(prev)} → ${sides(next)}`);
  return out;
}

/** The sessions played at one version of a game. */
export function sessionsAtVersion(log: CasinoLog, casinoId: string, gameId: string, versionId: string): CasinoSession[] {
  return log.sessions.filter((s) => s.casinoId === casinoId && s.gameId === gameId && s.versionId === versionId);
}

export interface VersionData {
  sessions: number;
  /** Figures are stored for these rules (for the Play profile in use). */
  figures: boolean;
}

/** What the game's current version holds: a rule change on it asks whether the casino changed it. */
export function currentVersionData(
  log: CasinoLog,
  casino: Casino,
  game: CasinoGame,
  profile: Profile,
  results: Readonly<Record<string, GameResult>>,
  archive: Readonly<Record<string, GameResult>>,
): VersionData {
  // Re-review R3: with the casino's sessions that never said which game, played at these rules.
  const sessions = sessionsAtGameVersion(log, casino.id, game, currentVersionId(game)).length;
  const figures = game.variant === undefined && !isHouseGame(game) && resultForKey(results, archive, game.id, simInputFor(game, profile, log.settings.methods ?? [], casino.kind).key) !== undefined;
  return { sessions, figures };
}

/**
 * Whether a rule change on this version asks "new version or fix?": only
 * when it holds sessions (logged results). Sim figures are derived and
 * simply recompute for the new rules; the old ones stay archived under
 * their spec key (casinoGameStats `saveGameResult`), so nothing is lost.
 */
export const hasData = (d: VersionData): boolean => d.sessions > 0;

/** "12 Oct 2026", local. */
export const dateText = (iso: string): string => longDate(localDateKey(new Date(iso)));

/** When a version's rules held: from its start to the next version's ("until" null: still current). */
export function versionSpan(game: CasinoGame, v: GameVersion): { from: string; until: string | null } {
  const list = versionsOf(game);
  const i = list.findIndex((x) => x.versionId === v.versionId);
  const next = list[i + 1];
  return { from: v.createdAt, until: next ? next.createdAt : null };
}

/**
 * C21 (audit 2026-10-29): the log with each casino's games replaced by their
 * earlier rule versions (gameAtVersion; variant and house games left out), so
 * the ranking can price them and AutoSim can work out any whose key has no
 * result -- after a profile or ramp edit, or a SIM_VERSION bump, nothing did,
 * and the earlier version's card lost its figures.
 */
export function earlierVersionLog(log: CasinoLog): CasinoLog {
  return {
    ...log,
    casinos: log.casinos.map((c) => ({
      ...c,
      games: c.games.filter((g) => g.variant === undefined && !isHouseGame(g)).flatMap((g) => earlierVersions(g).map((v) => gameAtVersion(g, v))),
    })),
  };
}

/**
 * The simulator keys of every earlier version in the log for this profile:
 * kept in the figures cache however many newer results push it
 * (casinoGameStats `pinGameKeys`), so an earlier version keeps its figures.
 */
export function earlierVersionKeys(log: CasinoLog, profile: Profile): string[] {
  const keys: string[] = [];
  for (const c of log.casinos) {
    for (const g of c.games) {
      if (g.variant !== undefined || isHouseGame(g)) continue;
      for (const v of earlierVersions(g)) keys.push(simInputFor(gameAtVersion(g, v), profile, log.settings.methods ?? [], c.kind).key);
    }
  }
  return keys;
}
