import { describe, it, expect } from 'vitest';
import { getChart } from '../../engine/charts';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { RuleSet } from '../../engine/ruleset';
import type { Card } from '../../engine/cards';
import {
  DEALER_UPCARDS,
  ACTION_LEGEND,
  buildSectionRows,
  upcardColumn,
  highlightForHand,
  rulesetSummary,
  isHighlighted,
  parseHighlightParam,
  normalizeRowOrder,
} from './chartRows';

// Every expectation below is derived from the ASSEMBLED chart the engine
// grades against (getChart), never from a re-transcription -- the whole point
// of the viewer is that it cannot drift from the trainer. Where a literal
// label is asserted (e.g. '4-8', 'A,9-10') it is cross-checked against
// docs/sources/verified-charts-transcription.md, which records how the source
// GIFs collapse those same rows.

const D68_H17 = DEFAULT_RULES; // 6 deck, H17, DAS, late surrender
const D1_H17: RuleSet = { ...DEFAULT_RULES, decks: 1 };
const D68_S17: RuleSet = { ...DEFAULT_RULES, s17: true };

function card(rank: Card['rank']): Card {
  return { rank, suit: 's' };
}

describe('DEALER_UPCARDS', () => {
  it('is the chart column order: 2..10 then A', () => {
    expect(DEALER_UPCARDS).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A']);
  });
});

describe('upcardColumn', () => {
  it('collapses every ten-value rank onto the single "10" column', () => {
    expect(upcardColumn('J')).toBe('10');
    expect(upcardColumn('Q')).toBe('10');
    expect(upcardColumn('K')).toBe('10');
    expect(upcardColumn('10')).toBe('10');
  });

  it('leaves 2-9 and A alone', () => {
    expect(upcardColumn('2')).toBe('2');
    expect(upcardColumn('9')).toBe('9');
    expect(upcardColumn('A')).toBe('A');
  });
});

describe('buildSectionRows: HARD', () => {
  const chart = getChart(D68_H17);

  it('collapses the leading all-hit run and the trailing all-stand run only', () => {
    // 6D/H17 with surrender: hard 17 vs A is Rs, so 17 is NOT part of the
    // all-stand tail -- the tail is 18-21 ("18+"). Hard 4-8 are all H.
    const rows = buildSectionRows(chart, 'HARD', 'ascending');
    expect(rows.map((r) => r.label)).toEqual(['4-8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18+']);
  });

  it('keeps identical MIDDLE rows separate (13 and 14 are the same but the source charts list both)', () => {
    const rows = buildSectionRows(chart, 'HARD', 'ascending');
    expect(chart.HARD[13]).toEqual(chart.HARD[14]);
    expect(rows.map((r) => r.label)).toContain('13');
    expect(rows.map((r) => r.label)).toContain('14');
  });

  it('descending is the exact reverse of ascending', () => {
    const asc = buildSectionRows(chart, 'HARD', 'ascending');
    const desc = buildSectionRows(chart, 'HARD', 'descending');
    expect(desc.map((r) => r.label)).toEqual([...asc.map((r) => r.label)].reverse());
    expect(desc[0].label).toBe('18+');
    expect(desc[desc.length - 1].label).toBe('4-8');
  });

  it('carries the assembled chart row verbatim as the cell actions', () => {
    const rows = buildSectionRows(chart, 'HARD', 'ascending');
    const sixteen = rows.find((r) => r.label === '16')!;
    expect(sixteen.actions).toEqual(chart.HARD[16]);
    expect(sixteen.actions).toHaveLength(DEALER_UPCARDS.length);
  });

  it('lists every collapsed total in `keys`, so a highlight on any of them finds the row', () => {
    const rows = buildSectionRows(chart, 'HARD', 'ascending');
    expect(rows.find((r) => r.label === '4-8')!.keys).toEqual([4, 5, 6, 7, 8]);
    expect(rows.find((r) => r.label === '18+')!.keys).toEqual([18, 19, 20, 21]);
    expect(rows.find((r) => r.label === '16')!.keys).toEqual([16]);
  });

  it('collapses 1-deck H17 as 4-7 (hard 8 doubles vs 5-6 there, so it stands alone)', () => {
    // docs/sources/verified-charts-transcription.md, 1D H17: "4-7" then "8".
    const rows = buildSectionRows(getChart(D1_H17), 'HARD', 'ascending');
    expect(rows[0].label).toBe('4-7');
    expect(rows[1].label).toBe('8');
  });

  it('collapses 6-deck S17 to a 17+ tail (no 17-vs-A surrender there)', () => {
    const rows = buildSectionRows(getChart(D68_S17), 'HARD', 'ascending');
    expect(rows[rows.length - 1].label).toBe('17+');
  });
});

describe('buildSectionRows: SOFT', () => {
  const chart = getChart(D68_H17);

  it('labels soft rows by composition and collapses only the all-stand tail', () => {
    // Soft 19 is Ds vs 6, so it is not part of the tail; soft 20-21 are.
    const rows = buildSectionRows(chart, 'SOFT', 'ascending');
    expect(rows.map((r) => r.label)).toEqual(['A,2', 'A,3', 'A,4', 'A,5', 'A,6', 'A,7', 'A,8', 'A,9-10']);
  });

  it('maps composition labels back to soft totals in `keys`', () => {
    const rows = buildSectionRows(chart, 'SOFT', 'ascending');
    expect(rows.find((r) => r.label === 'A,7')!.keys).toEqual([18]);
    expect(rows.find((r) => r.label === 'A,9-10')!.keys).toEqual([20, 21]);
  });

  it('carries the assembled soft row verbatim', () => {
    const rows = buildSectionRows(chart, 'SOFT', 'ascending');
    expect(rows.find((r) => r.label === 'A,7')!.actions).toEqual(chart.SOFT[18]);
  });
});

describe('buildSectionRows: PAIRS', () => {
  const chart = getChart(D68_H17);

  it('lists one row per pair rank present in the chart, ace-high', () => {
    const rows = buildSectionRows(chart, 'PAIRS', 'ascending');
    expect(rows.map((r) => r.label)).toEqual(['2,2', '3,3', '4,4', '6,6', '7,7', '8,8', '9,9', 'A,A']);
  });

  it('treats the ace as the HIGH pair, so descending starts at A,A', () => {
    const rows = buildSectionRows(chart, 'PAIRS', 'descending');
    expect(rows[0].label).toBe('A,A');
    expect(rows[rows.length - 1].label).toBe('2,2');
  });

  it('never collapses pair rows even when two are identical (2,2 and 3,3 here)', () => {
    expect(chart.PAIRS['2']).toEqual(chart.PAIRS['3']);
    const rows = buildSectionRows(chart, 'PAIRS', 'ascending');
    expect(rows.filter((r) => r.label === '2,2' || r.label === '3,3')).toHaveLength(2);
  });

  it('keys a pair row by its rank', () => {
    const rows = buildSectionRows(chart, 'PAIRS', 'ascending');
    expect(rows.find((r) => r.label === '8,8')!.keys).toEqual(['8']);
    expect(rows.find((r) => r.label === 'A,A')!.actions).toEqual(chart.PAIRS.A);
  });
});

describe('buildSectionRows: row ids', () => {
  it('are unique and stable within a section', () => {
    const chart = getChart(D68_H17);
    for (const section of ['HARD', 'SOFT', 'PAIRS'] as const) {
      const ids = buildSectionRows(chart, section, 'ascending').map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => id.startsWith(`${section}:`))).toBe(true);
    }
  });
});

describe('highlightForHand', () => {
  it('routes a splittable pair to its PAIRS row', () => {
    expect(highlightForHand([card('8'), card('8')], '9', D68_H17)).toEqual({
      section: 'PAIRS',
      row: '8',
      dealerUp: '9',
    });
  });

  it('routes A,A to the PAIRS ace row, not soft 12', () => {
    expect(highlightForHand([card('A'), card('A')], '5', D68_H17)).toEqual({
      section: 'PAIRS',
      row: 'A',
      dealerUp: '5',
    });
  });

  it('routes a ten-pair to hard 20 -- the PAIRS table has no ten row', () => {
    expect(highlightForHand([card('K'), card('Q')], '6', D68_H17)).toEqual({
      section: 'HARD',
      row: 20,
      dealerUp: '6',
    });
  });

  it('routes 5,5 to hard 10 -- the PAIRS table has no five row', () => {
    expect(highlightForHand([card('5'), card('5')], '6', D68_H17)).toEqual({
      section: 'HARD',
      row: 10,
      dealerUp: '6',
    });
  });

  it('routes a pair to its hard total when splitting was not available', () => {
    // Mirrors strategy.play()'s fallback: with !canSplit the cell actually
    // consulted is the hard-total one, so that is the cell to anchor on.
    expect(highlightForHand([card('8'), card('8')], '9', D68_H17, { canSplit: false })).toEqual({
      section: 'HARD',
      row: 16,
      dealerUp: '9',
    });
  });

  it('routes a soft non-pair hand to its SOFT row', () => {
    expect(highlightForHand([card('A'), card('7')], '3', D68_H17)).toEqual({
      section: 'SOFT',
      row: 18,
      dealerUp: '3',
    });
  });

  it('routes a multi-card hard hand to its HARD row', () => {
    expect(highlightForHand([card('4'), card('5'), card('7')], '10', D68_H17)).toEqual({
      section: 'HARD',
      row: 16,
      dealerUp: '10',
    });
  });

  it('normalizes the dealer upcard onto its column rank', () => {
    expect(highlightForHand([card('10'), card('6')], 'J', D68_H17)!.dealerUp).toBe('10');
  });

  it('returns null for a hand outside the chart (a bust total has no row)', () => {
    expect(highlightForHand([card('10'), card('9'), card('5')], '6', D68_H17)).toBeNull();
  });

  it('honours the ruleset when deciding pair membership (1D 4,4 has a row too)', () => {
    expect(highlightForHand([card('4'), card('4')], '5', D1_H17)).toEqual({
      section: 'PAIRS',
      row: '4',
      dealerUp: '5',
    });
  });
});

describe('isHighlighted', () => {
  const chart = getChart(D68_H17);

  it('matches a collapsed row by any total it covers', () => {
    const rows = buildSectionRows(chart, 'HARD', 'ascending');
    const tail = rows.find((r) => r.label === '18+')!;
    expect(isHighlighted(tail, 'HARD', { section: 'HARD', row: 20, dealerUp: '6' })).toBe(true);
    expect(isHighlighted(tail, 'HARD', { section: 'HARD', row: 17, dealerUp: '6' })).toBe(false);
  });

  it('never matches a row in a different section', () => {
    const rows = buildSectionRows(chart, 'SOFT', 'ascending');
    const soft18 = rows.find((r) => r.label === 'A,7')!;
    expect(isHighlighted(soft18, 'SOFT', { section: 'HARD', row: 18, dealerUp: '6' })).toBe(false);
  });

  it('is false when there is no highlight at all', () => {
    const rows = buildSectionRows(chart, 'PAIRS', 'ascending');
    expect(isHighlighted(rows[0], 'PAIRS', undefined)).toBe(false);
  });
});

describe('ACTION_LEGEND', () => {
  it('spells out every action code an assembled chart can contain', () => {
    const codes = ACTION_LEGEND.map((entry) => entry.code);
    expect(codes).toEqual(['H', 'S', 'Dh', 'Ds', 'P', 'Rh', 'Rs', 'Rp']);
  });

  it('never omits a code that actually appears in an assembled chart', () => {
    const codes = new Set(ACTION_LEGEND.map((entry) => entry.code));
    const seen = new Set<string>();
    for (const decks of [1, 2, 6] as const) {
      for (const s17 of [false, true]) {
        for (const das of [false, true]) {
          for (const ls of [false, true]) {
            const chart = getChart({ ...DEFAULT_RULES, decks, s17, das, ls });
            for (const section of ['HARD', 'SOFT', 'PAIRS'] as const) {
              for (const row of buildSectionRows(chart, section, 'ascending')) {
                for (const action of row.actions) seen.add(action);
              }
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const action of seen) expect(codes.has(action as never)).toBe(true);
  });

  it('gives every code a plain-English expansion naming its fallback', () => {
    for (const entry of ACTION_LEGEND) {
      // Every label is real prose, never a restatement of the code itself.
      expect(entry.label).not.toBe(entry.code);
      // Two-letter codes are conditional -- their label must state the fallback.
      if (entry.code.length === 2) expect(entry.label).toMatch(/else/i);
    }
    expect(ACTION_LEGEND.find((e) => e.code === 'Dh')!.label).toMatch(/double if allowed, else hit/i);
    expect(ACTION_LEGEND.find((e) => e.code === 'Rh')!.label).toMatch(/surrender if allowed, else hit/i);
    expect(ACTION_LEGEND.find((e) => e.code === 'Rp')!.label).toMatch(/surrender if allowed, else split/i);
  });
});

describe('parseHighlightParam', () => {
  it('parses a hard/soft descriptor with a numeric row', () => {
    expect(parseHighlightParam('HARD:16:9')).toEqual({ section: 'HARD', row: 16, dealerUp: '9' });
    expect(parseHighlightParam('SOFT:18:3')).toEqual({ section: 'SOFT', row: 18, dealerUp: '3' });
  });

  it('parses a pairs descriptor with a rank row', () => {
    expect(parseHighlightParam('PAIRS:8:A')).toEqual({ section: 'PAIRS', row: '8', dealerUp: 'A' });
    expect(parseHighlightParam('PAIRS:A:5')).toEqual({ section: 'PAIRS', row: 'A', dealerUp: '5' });
  });

  it('normalizes a ten-value dealer rank onto the 10 column', () => {
    expect(parseHighlightParam('HARD:16:K')!.dealerUp).toBe('10');
  });

  it('returns undefined for anything malformed, so a bad link cannot break the screen', () => {
    expect(parseHighlightParam(null)).toBeUndefined();
    expect(parseHighlightParam('')).toBeUndefined();
    expect(parseHighlightParam('HARD:16')).toBeUndefined();
    expect(parseHighlightParam('BOGUS:16:9')).toBeUndefined();
    expect(parseHighlightParam('HARD:sixteen:9')).toBeUndefined();
    expect(parseHighlightParam('HARD:16:Z')).toBeUndefined();
    expect(parseHighlightParam('PAIRS:Z:9')).toBeUndefined();
  });
});

describe('normalizeRowOrder', () => {
  it('accepts the two real values', () => {
    expect(normalizeRowOrder('ascending')).toBe('ascending');
    expect(normalizeRowOrder('descending')).toBe('descending');
  });

  it('falls back to descending for missing or junk stored values', () => {
    expect(normalizeRowOrder(null)).toBe('descending');
    expect(normalizeRowOrder('')).toBe('descending');
    expect(normalizeRowOrder('sideways')).toBe('descending');
  });
});

describe('rulesetSummary', () => {
  it('names the deck count, the soft-17 rule, DAS and surrender', () => {
    expect(rulesetSummary(D68_H17)).toBe('6 deck · H17 · DAS · Late surrender');
  });

  it('flips every clause when the rules do', () => {
    expect(rulesetSummary({ ...DEFAULT_RULES, decks: 1, s17: true, das: false, ls: false })).toBe(
      '1 deck · S17 · No DAS · No surrender',
    );
  });

  it('says "2 deck" not "2 decks" so the header stays one tight line', () => {
    expect(rulesetSummary({ ...DEFAULT_RULES, decks: 2 })).toContain('2 deck');
  });
});
