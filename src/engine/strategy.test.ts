import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { correctPlay, basicPlay, insuranceCorrect } from './strategy';
import type { PlayContext, Advice } from './strategy';
import type { RuleSet } from './ruleset';

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

// ctx defaults per brief: canDouble true, canSplit true, canSurrender false
function ctx(overrides: Partial<PlayContext> = {}): PlayContext {
  return { canDouble: true, canSplit: true, canSurrender: false, ...overrides };
}

function expectAdvice(advice: Advice, action: Advice['action'], deviationId?: string) {
  expect(advice.action).toBe(action);
  if (deviationId) {
    expect(advice.source).toBe('illustrious18');
    expect(advice.deviationId).toBe(deviationId);
  } else {
    expect(advice.source).toBe('basic');
  }
}

describe('correctPlay: 16v10 -- (10,6) v 10', () => {
  it('canSurrender:true -> surrender (basic surrender beats deviation) at tc 0', () => {
    expectAdvice(correctPlay(cards('10', '6'), '10', 0, ctx({ canSurrender: true })), 'surrender');
  });
  it('canSurrender:true -> surrender at tc 9 too (count never overrides basic surrender)', () => {
    expectAdvice(correctPlay(cards('10', '6'), '10', 9, ctx({ canSurrender: true })), 'surrender');
  });
  it('canSurrender:false, tc 0 -> stand 16v10', () => {
    expectAdvice(correctPlay(cards('10', '6'), '10', 0, ctx({ canSurrender: false })), 'stand', '16v10');
  });
  it('canSurrender:false, tc -1 -> hit (basic, below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '6'), '10', -1, ctx({ canSurrender: false })), 'hit');
  });
  it('canSurrender:false, tc 5 -> stand 16v10 (above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '6'), '10', 5, ctx({ canSurrender: false })), 'stand', '16v10');
  });
});

describe('correctPlay: 16v9 -- (9,7) v 9', () => {
  it('tc 3 -> hit', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 3, ctx()), 'hit');
  });
  it('tc 4 -> stand 16v9', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 4, ctx()), 'stand', '16v9');
  });
  it('tc 8 -> stand 16v9 (above threshold)', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 8, ctx()), 'stand', '16v9');
  });
});

describe('correctPlay: 15v10 -- (K,5) v 10', () => {
  it('tc 3 -> hit', () => {
    expectAdvice(correctPlay(cards('K', '5'), '10', 3, ctx()), 'hit');
  });
  it('tc 4 -> stand 15v10', () => {
    expectAdvice(correctPlay(cards('K', '5'), '10', 4, ctx()), 'stand', '15v10');
  });
  it('tc 9 -> stand 15v10 (above threshold)', () => {
    expectAdvice(correctPlay(cards('K', '5'), '10', 9, ctx()), 'stand', '15v10');
  });
});

describe('correctPlay: 10v10 -- (6,4) v 10', () => {
  it('tc 3 -> hit', () => {
    expectAdvice(correctPlay(cards('6', '4'), '10', 3, ctx()), 'hit');
  });
  it('tc 4 -> double 10v10', () => {
    expectAdvice(correctPlay(cards('6', '4'), '10', 4, ctx()), 'double', '10v10');
  });
  it('tc 4, canDouble:false -> hit (falls through to basic)', () => {
    expectAdvice(correctPlay(cards('6', '4'), '10', 4, ctx({ canDouble: false })), 'hit');
  });
  it('tc 7 -> double 10v10 (above threshold)', () => {
    expectAdvice(correctPlay(cards('6', '4'), '10', 7, ctx()), 'double', '10v10');
  });
});

describe('correctPlay: 10vA -- (6,4) v A', () => {
  it('tc 2 -> hit', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 2, ctx()), 'hit');
  });
  it('tc 3 -> double 10vA', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 3, ctx()), 'double', '10vA');
  });
  it('tc 6 -> double 10vA (above threshold)', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 6, ctx()), 'double', '10vA');
  });
});

describe('correctPlay: 9v2 -- (5,4) v 2', () => {
  it('tc 0 -> hit', () => {
    expectAdvice(correctPlay(cards('5', '4'), '2', 0, ctx()), 'hit');
  });
  it('tc 1 -> double 9v2', () => {
    expectAdvice(correctPlay(cards('5', '4'), '2', 1, ctx()), 'double', '9v2');
  });
  it('tc 5 -> double 9v2 (above threshold)', () => {
    expectAdvice(correctPlay(cards('5', '4'), '2', 5, ctx()), 'double', '9v2');
  });
});

describe('correctPlay: 9v7 -- (5,4) v 7', () => {
  it('tc 2 -> hit', () => {
    expectAdvice(correctPlay(cards('5', '4'), '7', 2, ctx()), 'hit');
  });
  it('tc 3 -> double 9v7', () => {
    expectAdvice(correctPlay(cards('5', '4'), '7', 3, ctx()), 'double', '9v7');
  });
  it('tc 6 -> double 9v7 (above threshold)', () => {
    expectAdvice(correctPlay(cards('5', '4'), '7', 6, ctx()), 'double', '9v7');
  });
});

describe('correctPlay: 12v2 -- (10,2) v 2', () => {
  it('tc 2 -> hit', () => {
    expectAdvice(correctPlay(cards('10', '2'), '2', 2, ctx()), 'hit');
  });
  it('tc 3 -> stand 12v2', () => {
    expectAdvice(correctPlay(cards('10', '2'), '2', 3, ctx()), 'stand', '12v2');
  });
  it('tc 7 -> stand 12v2 (above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '2', 7, ctx()), 'stand', '12v2');
  });
});

describe('correctPlay: 12v3 -- (10,2) v 3', () => {
  it('tc 1 -> hit', () => {
    expectAdvice(correctPlay(cards('10', '2'), '3', 1, ctx()), 'hit');
  });
  it('tc 2 -> stand 12v3', () => {
    expectAdvice(correctPlay(cards('10', '2'), '3', 2, ctx()), 'stand', '12v3');
  });
  it('tc 6 -> stand 12v3 (above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '3', 6, ctx()), 'stand', '12v3');
  });
});

describe('correctPlay: 12v4 -- (10,2) v 4', () => {
  it('tc 0 -> stand (basic, above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '4', 0, ctx()), 'stand');
  });
  it('tc -1 -> hit 12v4', () => {
    expectAdvice(correctPlay(cards('10', '2'), '4', -1, ctx()), 'hit', '12v4');
  });
  it('tc -5 -> hit 12v4 (further below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '4', -5, ctx()), 'hit', '12v4');
  });
});

describe('correctPlay: 12v5 -- (10,2) v 5', () => {
  it('tc -1 -> stand (basic, above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '5', -1, ctx()), 'stand');
  });
  it('tc -2 -> hit 12v5', () => {
    expectAdvice(correctPlay(cards('10', '2'), '5', -2, ctx()), 'hit', '12v5');
  });
  it('tc -6 -> hit 12v5 (further below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '5', -6, ctx()), 'hit', '12v5');
  });
});

describe('correctPlay: 12v6 -- (10,2) v 6', () => {
  it('tc -2 -> stand (basic, above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -2, ctx()), 'stand');
  });
  it('tc -3 -> hit 12v6', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -3, ctx()), 'hit', '12v6');
  });
  it('tc -7 -> hit 12v6 (further below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -7, ctx()), 'hit', '12v6');
  });
});

describe('correctPlay: 13v2 -- (10,3) v 2', () => {
  it('tc -1 -> hit 13v2', () => {
    expectAdvice(correctPlay(cards('10', '3'), '2', -1, ctx()), 'hit', '13v2');
  });
  it('tc 0 -> stand (basic, above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '3'), '2', 0, ctx()), 'stand');
  });
  it('tc -5 -> hit 13v2 (further below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '3'), '2', -5, ctx()), 'hit', '13v2');
  });
});

describe('correctPlay: 13v3 -- (10,3) v 3', () => {
  it('tc -1 -> stand (basic, above threshold)', () => {
    expectAdvice(correctPlay(cards('10', '3'), '3', -1, ctx()), 'stand');
  });
  it('tc -2 -> hit 13v3', () => {
    expectAdvice(correctPlay(cards('10', '3'), '3', -2, ctx()), 'hit', '13v3');
  });
  it('tc -6 -> hit 13v3 (further below threshold)', () => {
    expectAdvice(correctPlay(cards('10', '3'), '3', -6, ctx()), 'hit', '13v3');
  });
});

describe('correctPlay: TTv6 -- (K,Q) v 6', () => {
  it('tc 3 -> stand (basic, ten-pair always stands)', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '6', 3, ctx()), 'stand');
  });
  it('tc 4 -> split TTv6', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '6', 4, ctx()), 'split', 'TTv6');
  });
  it('tc 8 -> split TTv6 (above threshold)', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '6', 8, ctx()), 'split', 'TTv6');
  });
});

describe('correctPlay: TTv5 -- (K,Q) v 5', () => {
  it('tc 4 -> stand (basic, ten-pair always stands)', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '5', 4, ctx()), 'stand');
  });
  it('tc 5 -> split TTv5', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '5', 5, ctx()), 'split', 'TTv5');
  });
  it('tc 9 -> split TTv5 (above threshold)', () => {
    expectAdvice(correctPlay(cards('K', 'Q'), '5', 9, ctx()), 'split', 'TTv5');
  });
});

describe('correctPlay: 11vA is inactive -- (6,5) v A always doubles via basic', () => {
  it('tc -5 -> double, source basic', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', -5, ctx()), 'double');
  });
  it('tc 0 -> double, source basic', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', 0, ctx()), 'double');
  });
  it('tc 5 -> double, source basic', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', 5, ctx()), 'double');
  });
});

describe('correctPlay: soft 16 must NOT trigger 16v10', () => {
  it('(A,5) v 10, tc 5 -> hit', () => {
    expectAdvice(correctPlay(cards('A', '5'), '10', 5, ctx()), 'hit');
  });
});

describe('correctPlay: 8,8 v 10 precedence', () => {
  it('canSplit:true, tc 5 -> split (pair beats 16v10 deviation)', () => {
    expectAdvice(correctPlay(cards('8', '8'), '10', 5, ctx({ canSplit: true })), 'split');
  });
  it('canSplit:false, tc 0 -> stand 16v10 (hard-16 re-lookup)', () => {
    expectAdvice(correctPlay(cards('8', '8'), '10', 0, ctx({ canSplit: false })), 'stand', '16v10');
  });
  it('canSplit:false, canSurrender:true, tc 0 -> surrender (basic surrender beats deviation)', () => {
    expectAdvice(
      correctPlay(cards('8', '8'), '10', 0, ctx({ canSplit: false, canSurrender: true })),
      'surrender',
    );
  });
  it('canSplit:false, canSurrender:true, tc 9 -> surrender (count never overrides basic surrender)', () => {
    expectAdvice(
      correctPlay(cards('8', '8'), '10', 9, ctx({ canSplit: false, canSurrender: true })),
      'surrender',
    );
  });
});

describe('correctPlay: 8,8 v A precedence (Rp)', () => {
  it('canSurrender:true -> surrender', () => {
    expectAdvice(correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: true })), 'surrender');
  });
  it('canSurrender:false -> split', () => {
    expectAdvice(correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: false })), 'split');
  });
});

describe('T8b: pair path consumes the assembled PAIRS cell generically (no hardcoded 8,8vA)', () => {
  describe('2D H17 (8,8) v A -- driven by whatever getChart resolved, not a hardcoded rank/up check', () => {
    it('das:true ls:true -> cell resolves to plain P at assembly -> split even though canSurrender:true', () => {
      const rules: RuleSet = { decks: 2, s17: false, das: true, ls: true, rsa: false, bj65: false };
      expectAdvice(
        correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: true, canSplit: true }), rules),
        'split',
      );
    });

    it('das:false ls:true -> cell stays Rp -> surrender', () => {
      const rules: RuleSet = { decks: 2, s17: false, das: false, ls: true, rsa: false, bj65: false };
      expectAdvice(
        correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: true, canSplit: true }), rules),
        'surrender',
      );
    });

    it('das:false ls:false -> stripLs resolves Rp -> P -> split', () => {
      const rules: RuleSet = { decks: 2, s17: false, das: false, ls: false, rsa: false, bj65: false };
      expectAdvice(
        correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: true, canSplit: true }), rules),
        'split',
      );
    });
  });

  describe('1D H17 (7,7) v 10 -- Rs pair cell, previously unhandled in the pair path', () => {
    const rules: RuleSet = { decks: 1, s17: false, das: true, ls: true, rsa: false, bj65: false };

    it('canSurrender:true -> surrender', () => {
      expectAdvice(correctPlay(cards('7', '7'), '10', 0, ctx({ canSurrender: true }), rules), 'surrender');
    });
    it('canSurrender:false -> stand (Rs fallback)', () => {
      expectAdvice(correctPlay(cards('7', '7'), '10', 0, ctx({ canSurrender: false }), rules), 'stand');
    });
    it('canSplit:false, canSurrender:false -> stand still (cell semantics, NOT a hard-14 re-lookup)', () => {
      // The 1D H17 hard-14 row vs dealer 10 is 'H' (hit) -- if this fell
      // through to resolveAsTotal instead of applying the pair cell's own
      // Rs-fallback, it would wrongly hit instead of stand.
      expectAdvice(
        correctPlay(cards('7', '7'), '10', 0, ctx({ canSplit: false, canSurrender: false }), rules),
        'stand',
      );
    });
  });

  describe('1D H17 (7,7) v A -- Rh pair cell', () => {
    const rules: RuleSet = { decks: 1, s17: false, das: true, ls: true, rsa: false, bj65: false };

    it('canSurrender:true -> surrender', () => {
      expectAdvice(correctPlay(cards('7', '7'), 'A', 0, ctx({ canSurrender: true }), rules), 'surrender');
    });
    it('canSurrender:false -> hit (Rh fallback)', () => {
      expectAdvice(correctPlay(cards('7', '7'), 'A', 0, ctx({ canSurrender: false }), rules), 'hit');
    });
  });

  describe('DEFAULT_RULES parity: (8,8) v A unchanged (v1 behavior, d68 Rp)', () => {
    it('canSurrender:true -> surrender', () => {
      expectAdvice(correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: true })), 'surrender');
    });
    it('canSurrender:false -> split', () => {
      expectAdvice(correctPlay(cards('8', '8'), 'A', 0, ctx({ canSurrender: false })), 'split');
    });
  });
});

describe('correctPlay: 3-card 16 v 10 with canDouble:false still applies stand deviation', () => {
  it('(5,4,7) v 10, tc 0 -> stand 16v10', () => {
    expectAdvice(correctPlay(cards('5', '4', '7'), '10', 0, ctx({ canDouble: false })), 'stand', '16v10');
  });
});

describe('insuranceCorrect', () => {
  it('tc 2 -> false', () => {
    expect(insuranceCorrect(2)).toBe(false);
  });
  it('tc 3 -> true', () => {
    expect(insuranceCorrect(3)).toBe(true);
  });
});

describe('basicPlay: deviations OFF', () => {
  it('(10,6) v 10, canSurrender:false -> hit even at tc 9', () => {
    expectAdvice(basicPlay(cards('10', '6'), '10', ctx({ canSurrender: false })), 'hit');
  });
});

describe('S17 Illustrious-18 variant: 11vA active at +1 threshold', () => {
  const s17Rules: RuleSet = { decks: 6, s17: true, das: true, ls: true, rsa: false, bj65: false };

  it('H17 (6,5) v A, tc 0 -> double basic (11vA inactive)', () => {
    const h17Rules: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
    expectAdvice(correctPlay(cards('6', '5'), 'A', 0, ctx(), h17Rules), 'double');
  });

  it('S17 (6,5) v A, tc 0 -> hit basic (11vA active but threshold not met)', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', 0, ctx(), s17Rules), 'hit');
  });

  it('S17 (6,5) v A, tc 1 -> double 11vA at threshold', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', 1, ctx(), s17Rules), 'double', '11vA');
  });

  it('S17 (6,5) v A, tc 5 -> double 11vA above threshold', () => {
    expectAdvice(correctPlay(cards('6', '5'), 'A', 5, ctx(), s17Rules), 'double', '11vA');
  });
});

describe('S17 Illustrious-18 variant: 16v9 threshold +5', () => {
  const s17Rules: RuleSet = { decks: 6, s17: true, das: true, ls: true, rsa: false, bj65: false };

  it('H17 (9,7) v 9, tc 4 -> stand 16v9', () => {
    const h17Rules: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
    expectAdvice(correctPlay(cards('9', '7'), '9', 4, ctx(), h17Rules), 'stand', '16v9');
  });

  it('S17 (9,7) v 9, tc 4 -> hit basic (16v9 threshold not met)', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 4, ctx(), s17Rules), 'hit');
  });

  it('S17 (9,7) v 9, tc 5 -> stand 16v9 at threshold', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 5, ctx(), s17Rules), 'stand', '16v9');
  });

  it('S17 (9,7) v 9, tc 8 -> stand 16v9 above threshold', () => {
    expectAdvice(correctPlay(cards('9', '7'), '9', 8, ctx(), s17Rules), 'stand', '16v9');
  });
});

describe('S17 Illustrious-18 variant: 10vA threshold +4', () => {
  const s17Rules: RuleSet = { decks: 6, s17: true, das: true, ls: true, rsa: false, bj65: false };

  it('H17 (6,4) v A, tc 3 -> double 10vA', () => {
    const h17Rules: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
    expectAdvice(correctPlay(cards('6', '4'), 'A', 3, ctx(), h17Rules), 'double', '10vA');
  });

  it('S17 (6,4) v A, tc 3 -> hit basic (10vA threshold not met)', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 3, ctx(), s17Rules), 'hit');
  });

  it('S17 (6,4) v A, tc 4 -> double 10vA at threshold', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 4, ctx(), s17Rules), 'double', '10vA');
  });

  it('S17 (6,4) v A, tc 7 -> double 10vA above threshold', () => {
    expectAdvice(correctPlay(cards('6', '4'), 'A', 7, ctx(), s17Rules), 'double', '10vA');
  });
});

describe('S17 Illustrious-18 variant: 12v6 threshold −1 (lte)', () => {
  const s17Rules: RuleSet = { decks: 6, s17: true, das: true, ls: true, rsa: false, bj65: false };

  it('H17 (10,2) v 6, tc -3 -> hit 12v6', () => {
    const h17Rules: RuleSet = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
    expectAdvice(correctPlay(cards('10', '2'), '6', -3, ctx(), h17Rules), 'hit', '12v6');
  });

  it('S17 (10,2) v 6, tc -2 -> hit 12v6 at threshold', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -2, ctx(), s17Rules), 'hit', '12v6');
  });

  it('S17 (10,2) v 6, tc -1 -> hit 12v6 at threshold', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -1, ctx(), s17Rules), 'hit', '12v6');
  });

  it('S17 (10,2) v 6, tc -5 -> hit 12v6 below threshold', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', -5, ctx(), s17Rules), 'hit', '12v6');
  });

  it('S17 (10,2) v 6, tc 0 -> stand basic (tc > threshold)', () => {
    expectAdvice(correctPlay(cards('10', '2'), '6', 0, ctx(), s17Rules), 'stand');
  });
});
