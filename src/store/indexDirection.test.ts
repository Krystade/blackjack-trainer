import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import type { GameConfig } from '../engine/game';
import { classifyAction } from '../engine/grade';
import type { GradedEvent } from '../engine/grade';
import { basicPlay, correctPlay } from '../engine/strategy';
import type { PlayContext } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';
import { applyEvents, indexDirectionFor } from './stats';
import { undoGradedEvent } from './undoEvent';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';

/**
 * E7 (W2-16): the per-index direction tally. `late` = missed deviation,
 * `early` = phantom deviation (credited through `phantomOf` for Play, whose
 * phantoms stay on their chart cell). cellStats routing must not move.
 */

const AT = '2026-10-17T12:00:00.000Z';

/** Play: hit 10,6 v 10 at TC +1, where 16 v 10 says stand (missed deviation). */
const PLAY_MISSED: GradedEvent = {
  source: 'table',
  kind: 'action',
  category: 'hard',
  correct: false,
  classification: 'missed-deviation',
  taken: 'hit',
  expected: 'stand',
  reason: '16 v 10: stand at TC ≥ 0',
  deviationId: '16v10',
  tc: 1,
  hand: '10,6 v 10',
};

/** Play: stand on 10,6 v 10 at TC −1, below the index (phantom deviation). */
const PLAY_PHANTOM: GradedEvent = {
  source: 'table',
  kind: 'action',
  category: 'hard',
  correct: false,
  classification: 'phantom-deviation',
  taken: 'stand',
  expected: 'hit',
  reason: 'Basic hit vs dealer 10',
  phantomOf: '16v10',
  tc: -1,
  hand: '10,6 v 10',
};

function busy(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.perIndex = { '16v10': { right: 4, wrong: 2 }, '12v3': { right: 1, wrong: 0 } };
  s.tablePerIndex = { '16v10': { right: 3, wrong: 1 } };
  s.cellStats = { 'hard-16-v-10': { right: 5, wrong: 1, lastAt: '2026-10-01T00:00:00.000Z', recent: '111101' } };
  s.indexDirection = { '12v3': { early: 2, late: 1 } };
  return s;
}

describe('E7: applyEvents direction tally', () => {
  it('a missed deviation adds one LATE to its index, pooled and for the table, and leaves cellStats alone', () => {
    const before = busy();
    const after = applyEvents(before, [PLAY_MISSED], AT);
    expect(after.indexDirection?.['16v10']).toEqual({ early: 0, late: 1 });
    expect(after.tableIndexDirection?.['16v10']).toEqual({ early: 0, late: 1 });
    expect(after.indexDirection?.['12v3']).toEqual({ early: 2, late: 1 });
    // An index event is never on its chart cell (F4): exactly as before.
    expect(after.cellStats).toEqual(before.cellStats);
    expect(after.perIndex['16v10']).toEqual({ right: 4, wrong: 3 });
  });

  it('a Play phantom with phantomOf adds one EARLY (off the tally) and its cellStats are the event without it', () => {
    const before = busy();
    const after = applyEvents(before, [PLAY_PHANTOM], AT);
    expect(after.indexDirection?.['16v10']).toEqual({ early: 1, late: 0, offTally: 1 });
    expect(after.tableIndexDirection?.['16v10']).toEqual({ early: 1, late: 0, offTally: 1 });
    // cellStats routing is unchanged: the phantom is still a miss on its cell,
    // byte-for-byte what the same event without phantomOf writes.
    const { phantomOf: _drop, ...bare } = PLAY_PHANTOM;
    void _drop;
    const legacy = applyEvents(before, [bare], AT);
    expect(after.cellStats).toEqual(legacy.cellStats);
    expect(after.cellStats?.['hard-16-v-10']?.wrong).toBe(2);
    expect(after.handRecent).toEqual(legacy.handRecent);
    // perIndex is untouched by a phantom that names no deviationId.
    expect(after.perIndex).toEqual(before.perIndex);
    expect(legacy.indexDirection).toEqual(before.indexDirection);
  });

  it('a drill phantom files EARLY under its deviationId, in the tally, with no table slice', () => {
    const quiz: GradedEvent = { ...PLAY_PHANTOM, source: 'quiz', phantomOf: undefined, deviationId: '16v10' };
    delete quiz.phantomOf;
    const after = applyEvents(busy(), [quiz], AT);
    expect(after.indexDirection?.['16v10']).toEqual({ early: 1, late: 0 });
    expect(after.tableIndexDirection).toBeUndefined();
  });

  it('insurance taken below the index is early on ins; declined above it is late', () => {
    const base: GradedEvent = {
      source: 'table', kind: 'insurance', category: 'insurance', correct: false,
      classification: 'phantom-deviation', taken: 'take', expected: 'decline',
      reason: 'Insurance vs dealer A at tc 1', deviationId: 'ins', tc: 1, hand: 'dealer A',
    };
    const late: GradedEvent = { ...base, classification: 'missed-deviation', taken: 'decline', expected: 'take', tc: 4 };
    const after = applyEvents(EMPTY_STATS, [base, late], AT);
    expect(after.indexDirection?.ins).toEqual({ early: 1, late: 1 });
  });

  it('Index-test misses, wrong-anyway, timeouts and right answers have no direction', () => {
    const indexTest: GradedEvent = {
      source: 'quiz', kind: 'action', category: 'hard', correct: false, classification: 'missed-deviation',
      taken: '2', expected: '0', reason: '16 v 10: stand at TC ≥ 0', deviationId: '16v10', indexOnly: true, tc: 0,
      hand: '10,6 v 10',
    };
    const wrongAnyway: GradedEvent = { ...PLAY_MISSED, classification: 'wrong-anyway', taken: 'double' };
    const timeout: GradedEvent = { ...PLAY_MISSED, source: 'quiz', classification: 'timeout', taken: 'timeout' };
    const right: GradedEvent = { ...PLAY_MISSED, correct: true, classification: 'correct', taken: 'stand' };
    for (const e of [indexTest, wrongAnyway, timeout, right]) expect(indexDirectionFor(e), e.classification).toBeNull();
    const after = applyEvents(EMPTY_STATS, [indexTest, wrongAnyway, timeout, right], AT);
    expect(after.indexDirection).toBeUndefined();
    expect(after.tableIndexDirection).toBeUndefined();
    // The Index-test miss is still a wrong answer on its index.
    expect(after.perIndex['16v10']?.wrong).toBe(3);
  });

  it('a non-index miss touches neither direction branch (shared by reference)', () => {
    const before = busy();
    const basic: GradedEvent = { ...PLAY_PHANTOM, classification: 'basic-error' };
    delete basic.phantomOf;
    const after = applyEvents(before, [basic], AT);
    expect(after.indexDirection).toBe(before.indexDirection);
  });

  it('Wrong tap withdraws the direction exactly', () => {
    for (const e of [PLAY_MISSED, PLAY_PHANTOM]) {
      for (const before of [busy(), structuredClone(EMPTY_STATS)]) {
        const once = applyEvents(before, [e], AT);
        const twice = applyEvents(once, [e], AT);
        expect(undoGradedEvent(once, e).indexDirection, e.classification).toEqual(before.indexDirection);
        expect(undoGradedEvent(once, e).tableIndexDirection, e.classification).toEqual(before.tableIndexDirection);
        expect(undoGradedEvent(twice, e).indexDirection).toEqual(once.indexDirection);
      }
    }
  });
});

describe('E7: the matched index travels with a phantom verdict', () => {
  const hand = (...ranks: Rank[]): Card[] => ranks.map((rank) => ({ rank, suit: 's' }));
  const ctx: PlayContext = { canDouble: true, canSplit: false, canSurrender: false };

  it('classifyAction returns phantomOf for a phantom and nothing for a basic error', () => {
    const cards = hand('10', '6');
    const withCount = correctPlay(cards, '10', -1, ctx, DEFAULT_RULES);
    const basicOnly = basicPlay(cards, '10', ctx, DEFAULT_RULES);
    expect(classifyAction('stand', withCount, basicOnly, cards, '10', -1, DEFAULT_RULES)).toEqual({
      classification: 'phantom-deviation',
      correct: false,
      phantomOf: '16v10',
    });
    expect(classifyAction('double', withCount, basicOnly, cards, '10', -1, DEFAULT_RULES)).toEqual({
      classification: 'basic-error',
      correct: false,
    });
  });

  it('a Play stand on 10,6 v 10 below the index carries phantomOf and no deviationId', () => {
    const cfg: GameConfig = {
      penetration: 0.75, betSpreadOn: false, spread: DEFAULT_SPREAD, bankrollStart: 100, countCheckEvery: 0, seed: 1,
      rules: { ...DEFAULT_RULES, ls: false },
    };
    // Rigged deal order: player, dealer up, player, dealer hole. Seen: 10, 10, 6 -> RC -1.
    const game = Game.withRiggedShoe(cfg, hand('10', '10', '6', '7', '5', '5', '5', '5'));
    game.startRound();
    expect(game.phase).toBe('player');
    game.act('stand');
    const ev = game.events.find((e) => e.kind === 'action')!;
    expect(ev.tc).toBeLessThan(0);
    expect(ev.classification).toBe('phantom-deviation');
    expect(ev.phantomOf).toBe('16v10');
    expect(ev.deviationId).toBeUndefined();
  });
});
