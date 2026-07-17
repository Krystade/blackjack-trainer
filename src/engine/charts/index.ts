import type { Rank } from '../cards';
import type { RuleSet } from '../ruleset';
import type { ChartAction } from './types';
import { HARD as HARD_D68_H17, SOFT as SOFT_D68_H17, PAIRS as PAIRS_D68_H17 } from './d68_h17';
import { HARD as HARD_D68_S17, SOFT as SOFT_D68_S17, PAIRS as PAIRS_D68_S17 } from './d68_s17';
import { HARD as HARD_D2_H17, SOFT as SOFT_D2_H17, PAIRS as PAIRS_D2_H17 } from './d2_h17';
import { HARD as HARD_D2_S17, SOFT as SOFT_D2_S17, PAIRS as PAIRS_D2_S17 } from './d2_s17';
import { HARD as HARD_D1_H17, SOFT as SOFT_D1_H17, PAIRS as PAIRS_D1_H17 } from './d1_h17';
import { HARD as HARD_D1_S17, SOFT as SOFT_D1_S17, PAIRS as PAIRS_D1_S17 } from './d1_s17';

export type { ChartAction } from './types';

export interface Chart {
  HARD: Record<number, ChartAction[]>;
  SOFT: Record<number, ChartAction[]>;
  PAIRS: Partial<Record<Rank, ChartAction[]>>;
}

type DeckClass = 'd68' | 'd2' | 'd1';
type S17Key = 'H17' | 'S17';

function deckClassFor(decks: RuleSet['decks']): DeckClass {
  if (decks >= 4) return 'd68';
  if (decks === 2) return 'd2';
  return 'd1';
}

// Registry of assembled charts, keyed by (deckClass, s17). All six base charts
// are registered: d68/H17, d68/S17, d2/H17, d2/S17, d1/H17, d1/S17.
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

/** Select the assembled {HARD, SOFT, PAIRS} chart for a ruleset's deck count + dealer-soft-17 rule. */
export function getChart(rules: RuleSet): Chart {
  const deckClass = deckClassFor(rules.decks);
  const s17Key: S17Key = rules.s17 ? 'S17' : 'H17';
  const chart = REGISTRY[deckClass]?.[s17Key];
  if (!chart) {
    throw new Error(`No chart for ${deckClass} ${s17Key} yet`);
  }
  return chart;
}
