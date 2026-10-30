import { methodBadge } from '../engine/betMethods';
import { workFor } from './casinoAutoSim';
import { evTargetMet, rankedEvHour, verdictOf, type RankRow } from './casinoRanking';
import { ciText, edgeText, evCiText, n0Text, pctText } from './casinoStatsText';

/**
 * Wave W review S1: ONE GAME'S FIGURE AS A LINE, for the directory row and
 * the casino page, by the ranking's own rules (GamesRanked `RankItem`,
 * review S3's `verdictOf`). The figure always carries its 95% interval; a
 * win or a loss is said only when all of the interval is on that side of
 * zero; an estimate, a partial run and a stale result (the rules or the
 * profile changed, new figures on the way) are marked as such.
 *
 * At a continuous shuffler there is no count to play: flat basic strategy
 * loses about the house edge, so a positive figure there is the noise of a
 * short run, never a profit. It reads "No counting edge", then "about
 * break-even ±$N/h" while the interval spans zero, and "loses $N/h" once all
 * of it is below. Only an interval wholly above zero (rules that really
 * favour the player) shows a gain, and says so. Nothing is clamped: the
 * wording follows the computed interval.
 */

export type FigureBadge = 'estimate' | 'partial' | 'updating' | 'notfirm';

export interface FigureLine {
  /** The figure in words, interval included. */
  text: string;
  /** The verdict's sign, for colour: 1 wins, -1 loses, 0 neither (or no figure). */
  sign: -1 | 0 | 1;
  /** What the figure is, beside it: an estimate, a partial run, or stale. */
  badges: FigureBadge[];
  /** "edge 0.62%", with its interval while the run is not done; null without figures. */
  edge: string | null;
  /** The rest of the line: N0 and the best method, once the figure is firm enough to name one. */
  extras: string[];
  /** A shuffler: there is no count to play. */
  csm: boolean;
}

export const BADGE_TEXT: Record<FigureBadge, string> = {
  estimate: 'Estimate',
  partial: 'Partial',
  updating: 'Updating',
  notfirm: 'Not firm',
};

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

export function figureLine(row: RankRow, failed?: string): FigureLine {
  const f = row.figures;
  const csm = f !== null ? f.methods === null : row.game.csm;
  const none = (text: string): FigureLine => ({ text, sign: 0, badges: [], edge: null, extras: [], csm });
  if (row.notModelled) return none('Not modelled: the simulator does not deal this game');
  const ev = rankedEvHour(row);
  if (!f || ev === null) return none(failed !== undefined ? 'Not worked out' : 'Figures being worked out…');

  const result = row.state.kind === 'none' ? undefined : row.state.result;
  const done = result?.status === 'done';
  const estimate = result !== undefined && workFor(result) === 'refine';
  const badges: FigureBadge[] = [];
  if (row.state.kind === 'stale') badges.push('updating');
  else if (estimate) badges.push('estimate');
  else if (!done) badges.push('partial');
  // C25 (audit 2026-10-29): a run finished at one exit-minutes setting can miss
  // the EV target at a longer one (the key ignores exit minutes); the stats
  // card says so, and the row now marks it too. The edge keeps no interval:
  // its own target does not move with exit minutes.
  else if (!evTargetMet(f)) badges.push('notfirm');

  // With a side bet the interval is the seated method's (sideCombinedText): the side figure carries none.
  const ci = row.withSide?.method ? row.withSide.method.hours.evHourCi : f.evHourCi;
  const verdict = verdictOf(ev, ci);
  const sign = verdict === 'wins' ? 1 : verdict === 'loses' ? -1 : 0;
  const edge = `edge ${done && !estimate ? pctText(f.edge) : edgeText(f.edge, f.edgeCi)}`;

  if (csm) {
    const text =
      verdict === 'even'
        ? `No counting edge · about break-even ${ciText(ci)}/h`
        : verdict === 'loses'
          ? `No counting edge · loses ${money(ev)}/h${done ? '' : ` ${ciText(ci)}`}`
          : `Rules favour the player · ${evCiText(ev, ci)}`;
    return { text, sign, badges, edge, extras: [], csm };
  }
  const text = verdict === 'even' ? `about break-even, ${evCiText(ev, ci)}` : evCiText(ev, ci);
  const extras: string[] = [];
  if (f.best) extras.push(`N0 ${n0Text(f.n0Hours)}`);
  // Review N6 (as on Ranked): an estimate names no best method.
  if (f.best && !estimate && row.state.kind !== 'stale') extras.push(methodBadge(row.withSide?.method?.method ?? f.best.method));
  return { text, sign, badges, edge, extras, csm };
}
