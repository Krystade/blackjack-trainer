import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setStorage, loadStats } from '../store/persist';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import { basicPlay } from '../engine/strategy';
import type { Action } from '../engine/deviations';
import { generateAllCells } from './flashcards';
import { FULL_CTX } from './fallbackHand';
import { loadFlashSr } from './gradeAnswer';
import { chartTestEvents, gradeChartTest, recordChartTest, scoreLine, tableCellIds, TEST_TABLES } from './chartTest';
import type { PaintedChart } from './chartTest';
import type { PaintSection } from './cellSelection';

const NOW = 1_700_000_000_000;
const H17: RuleSet = { ...DEFAULT_RULES, s17: false };
const S17: RuleSet = { ...DEFAULT_RULES, s17: true };
const SECTIONS: PaintSection[] = ['hard', 'soft', 'pair'];

const CELLS = new Map(generateAllCells().map((c) => [c.id, c]));

/**
 * The answer key, from the STRATEGY ENGINE (basicPlay on the cell's own two
 * cards, everything allowed) rather than from the chart lookup the module
 * grades with -- so a wrong row/column mapping in the module cannot agree
 * with itself here.
 */
function engineKey(rules: RuleSet, section: PaintSection): Record<string, Action> {
  return Object.fromEntries(
    tableCellIds(section).map((id) => {
      const cell = CELLS.get(id);
      if (!cell) throw new Error(`no flashcard cell ${id}`);
      return [id, basicPlay(cell.cards, cell.up, FULL_CTX, rules).action];
    }),
  );
}

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  _setStorage(ls);
  vi.stubGlobal('window', { localStorage: ls });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('F12: chart test grading', () => {
  it('the tables are the flashcard universe: hard 150, soft 80, pairs 100 cells', () => {
    expect(TEST_TABLES.map((t) => [t.section, tableCellIds(t.section).length])).toEqual([
      ['hard', 150],
      ['soft', 80],
      ['pair', 100],
    ]);
    for (const s of SECTIONS) for (const id of tableCellIds(s)) expect(CELLS.has(id), id).toBe(true);
  });

  for (const [name, rules] of [
    ['H17', H17],
    ['S17', S17],
  ] as const) {
    it(`${name}: the engine's own answers score full marks on every table`, () => {
      for (const s of SECTIONS) {
        const r = gradeChartTest(engineKey(rules, s), rules, s);
        expect(r.misses, `${name} ${s}`).toEqual([]);
        expect(r.right).toBe(r.total);
      }
    });

    it(`${name}: two deliberate misses are exactly the misses, scored`, () => {
      const painted: Record<string, Action> = { ...engineKey(rules, 'hard') };
      // 16 v 10 is surrender (H17 and S17 with LS): paint it stand. 11 v 6 is
      // double: paint it hit.
      painted['hard-16-v-10'] = 'stand';
      painted['hard-11-v-6'] = 'hit';
      const r = gradeChartTest(painted, rules, 'hard');
      expect(r.misses).toEqual(['hard-16-v-10', 'hard-11-v-6']);
      expect(scoreLine(r)).toBe('Hard: 148/150');
      const miss = r.cells.find((c) => c.cellId === 'hard-16-v-10')!;
      expect(miss).toMatchObject({ expected: 'surrender', painted: 'stand', correct: false });
    });
  }

  it("H17's answers graded under S17 miss exactly where the two strategies differ", () => {
    for (const s of SECTIONS) {
      const h = engineKey(H17, s);
      const sk = engineKey(S17, s);
      const differ = tableCellIds(s).filter((id) => h[id] !== sk[id]);
      expect(gradeChartTest(h, S17, s).misses, s).toEqual(differ);
    }
    // And there ARE differences (11 v A, soft 19 v 6...), or the line above
    // proves nothing.
    expect(gradeChartTest(engineKey(H17, 'hard'), S17, 'hard').misses).toContain('hard-11-v-A');
    expect(gradeChartTest(engineKey(H17, 'soft'), S17, 'soft').misses).toContain('soft-19-v-6');
  });

  it('an unpainted cell is a miss', () => {
    const painted: Record<string, Action | undefined> = { ...engineKey(H17, 'soft') };
    delete painted['soft-13-v-5'];
    const r = gradeChartTest(painted as PaintedChart, H17, 'soft');
    expect(r.misses).toEqual(['soft-13-v-5']);
    expect(chartTestEvents(r, NOW)[0]).toMatchObject({ taken: 'none', expected: 'double' });
  });
});

describe('F12: recording a chart test (misses only)', () => {
  it('writes each miss as a wrong answer, due now, under source chartTest -- and nothing for correct cells', () => {
    const painted: Record<string, Action> = { ...engineKey(H17, 'soft') };
    painted['soft-18-v-9'] = 'stand'; // hit
    painted['soft-13-v-5'] = 'hit'; // double
    const r = gradeChartTest(painted, H17, 'soft');
    const events = recordChartTest(r, NOW);

    expect(events).toHaveLength(2);
    for (const e of events) expect(e).toMatchObject({ source: 'chartTest', correct: false, kind: 'action' });
    expect(events.every((e) => e.elapsedMs === undefined)).toBe(true);

    const deck = loadFlashSr();
    expect(Object.keys(deck).sort()).toEqual(['soft-13-v-5', 'soft-18-v-9']);
    for (const id of ['soft-13-v-5', 'soft-18-v-9']) {
      expect(deck[id]!.box).toBe(0);
      expect(deck[id]!.dueAt).toBeLessThanOrEqual(NOW);
    }

    const stats = loadStats();
    expect(stats.cellStats?.['soft-18-v-9']).toMatchObject({ right: 0, wrong: 1 });
    expect(stats.cellStats?.['soft-13-v-5']).toMatchObject({ right: 0, wrong: 1 });
    // The 78 cells painted right were not recorded anywhere.
    expect(Object.keys(stats.cellStats ?? {}).sort()).toEqual(['soft-13-v-5', 'soft-18-v-9']);
    const bucket = stats.bySource?.chartTest;
    expect(bucket).toBeDefined();
    expect(Object.values(bucket!).reduce((n, t) => n + t.right, 0)).toBe(0);
    expect(Object.values(bucket!).reduce((n, t) => n + t.wrong, 0)).toBe(2);
    expect(stats.bySource?.flashcard).toBeUndefined();
  });

  it('a perfect table writes nothing at all', () => {
    expect(recordChartTest(gradeChartTest(engineKey(S17, 'pair'), S17, 'pair'), NOW)).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('a miss on a cell already well learned drops it back to box 0, due now', () => {
    store.set(
      'bjtrainer.flashsr.v1',
      JSON.stringify({ 'hard-12-v-3': { box: 4, dueAt: NOW + 9e9, lastSeenAt: NOW - 1e6, lapses: 0, reviews: 9 } }),
    );
    const painted: Record<string, Action> = { ...engineKey(H17, 'hard'), 'hard-12-v-3': 'stand' };
    recordChartTest(gradeChartTest(painted, H17, 'hard'), NOW);
    const card = loadFlashSr()['hard-12-v-3']!;
    expect(card.box).toBe(0);
    expect(card.dueAt).toBeLessThanOrEqual(NOW);
    expect(card.reviews).toBe(10);
  });
});
