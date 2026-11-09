import { describe, expect, it } from 'vitest';
import { TERMS, ownedAbbreviations, termForRuleLabel, type TermId } from './terms';
import { rulesChipLabels } from '../../drills/legalActions';
import { DEFAULT_RULES } from '../../engine/ruleset';

const ENTRIES = Object.entries(TERMS) as [TermId, (typeof TERMS)[TermId]][];

function sentences(text: string): number {
  // A sentence ends at . ! or ? followed by a space or the end. Decimals
  // ("2.5") and "e.g." do not occur in the definitions.
  return text.split(/[.!?](?:\s|$)/).filter((s) => s.trim().length > 0).length;
}

describe('glossary terms', () => {
  it('every term has a label and a one-to-three sentence definition', () => {
    for (const [id, e] of ENTRIES) {
      expect(e.label.trim(), id).not.toBe('');
      const n = sentences(e.def);
      expect(n, `${id}: ${e.def}`).toBeGreaterThanOrEqual(1);
      expect(n, `${id}: ${e.def}`).toBeLessThanOrEqual(3);
      expect(e.def.length, id).toBeLessThanOrEqual(240);
      expect(e.def.trim().endsWith('.'), id).toBe(true);
    }
  });

  it('no two terms share a label', () => {
    const labels = ENTRIES.map(([, e]) => e.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("no definition leans on another term's abbreviation", () => {
    // A beginner reading "the RC" in the true-count sheet would need a second
    // sheet to read the first. Spell it out instead.
    const owned = ownedAbbreviations();
    for (const [id, e] of ENTRIES) {
      for (const [abbr, owner] of owned) {
        if (owner === id) continue;
        expect(new RegExp(`\\b${abbr}\\b`).test(e.def), `${id} uses ${abbr} (owned by ${owner})`).toBe(false);
      }
    }
  });

  it('the abbreviation check can fail (a definition that says RC is caught)', () => {
    const owned = ownedAbbreviations();
    expect(owned.get('RC')).toBe('rc');
    expect(/\bRC\b/.test('Divide the RC by the decks left.')).toBe(true);
  });

  it('every rules-chip label the drills can show opens a term', () => {
    const seen = new Set<string>();
    for (const canSurrender of [true, false])
      for (const canDouble of [true, false])
        for (const ls of [true, false]) {
          const rules = { ...DEFAULT_RULES, ls };
          for (const l of rulesChipLabels({ canSurrender, canDouble }, rules)) seen.add(l);
        }
    expect([...seen].sort()).toEqual(['No double', 'No surrender', 'Surrender OK']);
    for (const l of seen) expect(termForRuleLabel(l), l).not.toBeNull();
    expect(termForRuleLabel('Something new')).toBeNull();
  });
});
