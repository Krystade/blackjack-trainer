import type { RuleSet } from '../ruleset';
import type { Chart, DeckClass } from './types';
import { HARD as HARD_D68_H17, SOFT as SOFT_D68_H17, PAIRS as PAIRS_D68_H17 } from './d68_h17';
import { HARD as HARD_D68_S17, SOFT as SOFT_D68_S17, PAIRS as PAIRS_D68_S17 } from './d68_s17';
import { HARD as HARD_D2_H17, SOFT as SOFT_D2_H17, PAIRS as PAIRS_D2_H17 } from './d2_h17';
import { HARD as HARD_D2_S17, SOFT as SOFT_D2_S17, PAIRS as PAIRS_D2_S17 } from './d2_s17';
import { HARD as HARD_D1_H17, SOFT as SOFT_D1_H17, PAIRS as PAIRS_D1_H17 } from './d1_h17';
import { HARD as HARD_D1_S17, SOFT as SOFT_D1_S17, PAIRS as PAIRS_D1_S17 } from './d1_s17';
import { resolveDas, stripLs, assertFullyResolved } from './transforms';

export type { ChartAction, Chart, DeckClass } from './types';

type S17Key = 'H17' | 'S17';

function deckClassFor(decks: RuleSet['decks']): DeckClass {
  if (decks >= 4) return 'd68';
  if (decks === 2) return 'd2';
  return 'd1';
}

// Registry of RAW base charts, keyed by (deckClass, s17). These may still
// contain DAS-conditional pair cells (Ph/Pd/Ps) and Rp -- getChart() below
// resolves them per-ruleset before returning. All six base charts are
// registered: d68/H17, d68/S17, d2/H17, d2/S17, d1/H17, d1/S17.
const REGISTRY: Partial<Record<DeckClass, Partial<Record<S17Key, Chart>>>> = {
  d68: {
    H17: { HARD: HARD_D68_H17, SOFT: SOFT_D68_H17, PAIRS: PAIRS_D68_H17 },
    S17: { HARD: HARD_D68_S17, SOFT: SOFT_D68_S17, PAIRS: PAIRS_D68_S17 },
  },
  d2: {
    H17: { HARD: HARD_D2_H17, SOFT: SOFT_D2_H17, PAIRS: PAIRS_D2_H17 },
    S17: { HARD: HARD_D2_S17, SOFT: SOFT_D2_S17, PAIRS: PAIRS_D2_S17 },
  },
  d1: {
    H17: { HARD: HARD_D1_H17, SOFT: SOFT_D1_H17, PAIRS: PAIRS_D1_H17 },
    S17: { HARD: HARD_D1_S17, SOFT: SOFT_D1_S17, PAIRS: PAIRS_D1_S17 },
  },
};

// Assembled-chart cache, keyed by (deckClass, s17, das, ls).
const ASSEMBLED_CACHE = new Map<string, Chart>();

/**
 * Select and fully resolve the {HARD, SOFT, PAIRS} chart for a ruleset:
 * picks the base table by deck count + dealer-soft-17 rule, then applies
 * resolveDas (das-conditional pair cells) followed by stripLs (surrender
 * fallbacks), and asserts no conditional cell survived. The returned Chart
 * always contains only H/S/Dh/Ds/P/Rh/Rs/Rp -- never Ph/Pd/Ps.
 * The returned chart is immutable (frozen).
 */
export function getChart(rules: RuleSet): Chart {
  const deckClass = deckClassFor(rules.decks);
  const s17Key: S17Key = rules.s17 ? 'S17' : 'H17';
  const cacheKey = `${deckClass}|${s17Key}|${rules.das}|${rules.ls}`;

  const cached = ASSEMBLED_CACHE.get(cacheKey);
  if (cached) return cached;

  const base = REGISTRY[deckClass]?.[s17Key];
  if (!base) {
    throw new Error(`No chart for ${deckClass} ${s17Key} yet`);
  }

  const assembled = stripLs(resolveDas(base, rules.das, deckClass), rules.ls);
  assertFullyResolved(assembled);

  // Freeze the chart to prevent mutations: freeze row arrays first, then the records and object
  for (const row of Object.values(assembled.HARD)) Object.freeze(row);
  for (const row of Object.values(assembled.SOFT)) Object.freeze(row);
  for (const row of Object.values(assembled.PAIRS)) Object.freeze(row);
  Object.freeze(assembled.HARD);
  Object.freeze(assembled.SOFT);
  Object.freeze(assembled.PAIRS);
  Object.freeze(assembled);

  ASSEMBLED_CACHE.set(cacheKey, assembled);
  return assembled;
}
