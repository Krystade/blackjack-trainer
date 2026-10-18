import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import { indexSetFor } from '../engine/deviations';
import { narrateReason, narrateTc } from '../audio/narrate';
import { indexPlayAt, publishedIndex } from './indexDisplay';
import { indexTestItemFor, indexTestPlayLine, indexTestSet, narrateIndexTestCorrection } from './indexTest';
import { signed } from './signed';

/**
 * D-R13: every surface that shows or says an index uses the published form,
 * "stand at TC ≥ −3" / "stand at true count minus three or higher" -- the
 * play AT the index, counted upward. Never the stored `lte` reading ("hit at
 * TC ≤ −4", "or lower"), whichever rules, deck count or extras are on.
 */
const RULESETS: StrategyRules[] = [];
for (const decks of [1, 2, 6, 8] as const) {
  for (const s17 of [false, true]) {
    for (const surrenderIndices of [false, true]) {
      for (const bjaExtras of [false, true]) RULESETS.push({ ...DEFAULT_RULES, decks, s17, surrenderIndices, bjaExtras });
    }
  }
}
const name = (r: StrategyRules) => `${r.decks}D ${r.s17 ? 'S17' : 'H17'} fab4=${r.surrenderIndices} bja=${r.bjaExtras}`;
const LABEL = /^[^:]+: (\w+) at TC ≥ ([+−]?\d+)(;| \(|$)/;

describe.each(RULESETS.map((r) => [name(r), r] as const))('%s', (_, rules) => {
  const active = indexSetFor(rules).filter((d) => d.active);

  it('labels name the play AT the published index, counted upward', () => {
    for (const dev of active) {
      const m = LABEL.exec(dev.label);
      expect(m, `${dev.id}: ${dev.label}`).not.toBeNull();
      if (dev.id !== 'ins') expect(m![1], dev.id).toBe(indexPlayAt(dev)); // insurance reads "take"
      expect(m![2], dev.id).toBe(signed(publishedIndex(dev)));
    }
  });

  it('spoken labels say "or higher" at the published count, never "or lower"', () => {
    for (const dev of active) {
      const spoken = narrateReason(dev.label);
      expect(spoken, dev.id).toContain(`${narrateTc(publishedIndex(dev))} or higher`);
      expect(spoken, dev.id).not.toMatch(/or lower|≤|≥/);
    }
  });

  it('the Index test line and spoken correction use the same published index', () => {
    for (const dev of indexTestSet(rules)) {
      const item = indexTestItemFor(dev, rules, mulberry32(3));
      expect(indexTestPlayLine(item), dev.id).toContain(`at TC ≥ ${signed(publishedIndex(dev))}`);
      expect(narrateIndexTestCorrection(item, false), dev.id).not.toMatch(/or lower|≤/);
    }
  });
});
