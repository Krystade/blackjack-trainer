import { payTableOf } from './payTables';
import type { SideBetId } from './payTables';
import { fullComp } from './comp';
import { sideBetEv } from './odds';
import { SideSim, countedResult, findTrigger } from './sideSim';
import { candidateCounts, chooseCount } from './select';
import type { Candidate } from './select';
import type { SideBetRow } from './plan';
import { DEFAULT_RULES } from '../ruleset';
import type { RuleSet } from '../ruleset';

/**
 * Wave L: ONE ROW OF WHAT THE APP KNOWS ABOUT A SIDE BET -- exact edge and
 * effects, every candidate count simulated on the same rounds, the count
 * chosen (select.ts). The generator (scripts/sideBetsGenerate.test.ts) writes
 * these for the standard cuts; the casino tab runs one at a logged game's own
 * cut, in a worker.
 */

export interface SideRowSpec {
  bet: SideBetId;
  payTable: string;
  decks: RuleSet['decks'];
  /** Buster only; null for every other bet (none depends on the dealer's rule). */
  s17: boolean | null;
  cutDecks: number;
  rounds: number;
  seed: number;
}

const r6 = (x: number) => Number(x.toPrecision(6));

/**
 * Review S5: the side-bet simulation's version. BUMP IT with any change that
 * can move a row -- the side simulation's binning or true count (sideSim.ts),
 * the count candidates or the choice (select.ts), effects of removal (eor.ts),
 * the bet's odds (odds.ts), this builder -- so rows cached at a game's own cut
 * (store/casinoSideRows.ts) are recomputed rather than outliving the fix. The
 * main simulator's SIM_VERSION is in the cache key too: the side run deals
 * its shoes.
 */
export const SIDE_SIM_VERSION = 1;

/** FNV-1a of a row's key: the seed, so a row is reproducible from its key alone. */
export function seedFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildSideRow(spec: SideRowSpec): SideBetRow {
  const t = payTableOf(spec.bet, spec.payTable);
  if (!t) throw new Error(`unknown pay table ${spec.bet}/${spec.payTable}`);
  const ruleS17 = spec.s17 ?? true;
  const rules: RuleSet = { ...DEFAULT_RULES, decks: spec.decks, s17: ruleS17 };
  const { counts, correlation, eor } = candidateCounts(t.bet, t.pays, spec.decks, ruleS17);
  const linear = t.bet === 'buster';
  const sim = new SideSim({ bet: t.bet, pays: t.pays, rules, cutDecks: spec.cutDecks, counts, linear }, spec.seed);
  sim.run(spec.rounds);
  const cands: Candidate[] = counts.map((c, i) => {
    const bins = sim.binsOf(i);
    const trigger = findTrigger(bins, c.betBelow);
    return { def: c.def, betBelow: c.betBelow, correlation: correlation[i] ?? null, ...countedResult(bins, sim.rounds, trigger, c.betBelow) };
  });
  const evTop = sideBetEv(t.bet, t.pays, fullComp(spec.decks), { s17: ruleS17 });
  const choice = chooseCount(evTop, cands);
  return {
    bet: t.bet,
    payTable: t.id,
    decks: spec.decks,
    s17: spec.s17,
    cutDecks: spec.cutDecks,
    rounds: spec.rounds,
    seed: spec.seed,
    edge: r6(-evTop),
    linear,
    eor: eor.map(r6),
    always: choice.always,
    chosen: choice.chosen?.def.id ?? null,
    candidates: cands.map((c) => ({
      id: c.def.id,
      name: c.def.name,
      kind: c.def.kind,
      ...(c.def.kind === 'tags' && c.def.id !== 'hilo' ? { tags: [...(c.def.tags ?? [])] } : {}),
      ...(c.betBelow ? { betBelow: true } : {}),
      ...(c.def.sourceUrl ? { sourceUrl: c.def.sourceUrl } : {}),
      correlation: c.correlation === null ? null : r6(c.correlation),
      trigger: c.trigger,
      freq: r6(c.freq),
      edge: r6(c.edge),
      per100: r6(c.per100),
    })),
  };
}
