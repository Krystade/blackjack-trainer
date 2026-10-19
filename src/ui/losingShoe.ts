import { Game, type GameConfig, type SeatConfig } from '../engine/game';
import { buildDownswingScript, realignToScript } from '../drills/downswingShoe';

/**
 * #48-51: Play's "Losing shoe". The Downswing drill's rig (downswingShoe.ts),
 * dealt at the normal table and graded by the normal Play bet ramp.
 *
 * The rig is a SOLO script -- every round is a fixed card sequence in solo
 * deal order -- so a losing-shoe game sits alone with one hand whatever the
 * profile's seats say. Bots or extra hands would eat the script's cards and
 * turn every designed loss into noise.
 *
 * The setting is read when the game is built. Play is only left through End
 * session, and Settings is only reachable off the table, so a change always
 * takes effect at a fresh shoe: off returns to a fair shoe, on starts the rig.
 */
export const LOSING_SHOE_SEATS: SeatConfig = {
  bots: 0,
  playerHands: 1,
  playerPosition: 0,
  botMistakePct: 0,
};

/** How many scripted rounds one pass of the rig holds (it restocks after). */
export const LOSING_SHOE_ROUNDS = 60;

export interface PlayGame {
  game: Game;
  /** Script round boundaries for a losing shoe; null for a fair shoe. */
  boundaries: number[] | null;
}

export function makePlayGame(cfg: GameConfig, losingShoe: boolean): PlayGame {
  if (!losingShoe) return { game: new Game(cfg), boundaries: null };
  const script = buildDownswingScript(
    LOSING_SHOE_ROUNDS,
    cfg.seed ?? Math.floor(Math.random() * 0x7fffffff),
  );
  // The cut card sits exactly on the last scripted round, so the shoe
  // shuffles (restocking the same script from the top, whose boundaries
  // therefore stay valid, and resetting the count) instead of dealing the
  // padding tail, which is pushes rather than losses. The tail only absorbs
  // a round that ran over its script.
  const last = script.boundaries[script.boundaries.length - 1]!;
  // Wave J: the script is solo rounds, so a back-count table (bots added,
  // rounds watched) would deal off the end of every scripted round.
  const game = Game.withRiggedShoe(
    { ...cfg, seats: LOSING_SHOE_SEATS, penetration: last / script.cards.length, backCount: false },
    script.cards,
  );
  return { game, boundaries: script.boundaries };
}

/**
 * Before each deal: put the shoe back on a scripted round boundary, binning
 * (unseen, uncounted) whatever an off-script line or a sit-out left over.
 */
export function realignLosingShoe(pg: PlayGame): void {
  if (!pg.boundaries || !pg.game.isRigged) return;
  const game = pg.game;
  realignToScript(game.shoe, pg.boundaries, (n) => game.discardRiggedCards(n));
}
