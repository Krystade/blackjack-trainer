import { describe, it, expect } from 'vitest';
import { makeDefaultProfile } from '../store/profiles';
import { playConfigFor } from './playConfig';

describe('playConfigFor', () => {
  const base = makeDefaultProfile();

  it('#3: carries countCheckAsk through, and leaves it absent when the profile has none', () => {
    expect(playConfigFor({ ...base, countCheckAsk: 'true' }, 100, 1).countCheckAsk).toBe('true');
    expect('countCheckAsk' in playConfigFor(base, 100, 1)).toBe(false);
  });

  it('#34: carries gradeDeviations through, off included', () => {
    expect(playConfigFor({ ...base, gradeDeviations: false }, 100, 1).gradeDeviations).toBe(false);
    expect(playConfigFor({ ...base, gradeDeviations: true }, 100, 1).gradeDeviations).toBe(true);
    expect('gradeDeviations' in playConfigFor(base, 100, 1)).toBe(false);
  });

  it('#39: carries cutDecks and cutVary through, and neither when unset', () => {
    const cfg = playConfigFor({ ...base, cutDecks: 1.25, cutVary: true }, 100, 1);
    expect(cfg.cutDecks).toBe(1.25);
    expect(cfg.cutVary).toBe(true);
    const plain = playConfigFor(base, 100, 1);
    expect('cutDecks' in plain || 'cutVary' in plain).toBe(false);
  });

  it('Wave J: carries "start each shoe out" and the entry point through, and neither when unset', () => {
    const cfg = playConfigFor({ ...base, startShoeOut: true, wongInTc: 2 }, 100, 1);
    expect(cfg.startShoeOut).toBe(true);
    expect(cfg.wongInTc).toBe(2);
    const plain = playConfigFor(base, 100, 1);
    expect('startShoeOut' in plain || 'backCount' in plain || 'wongInTc' in plain).toBe(false);
    expect('startShoeOut' in playConfigFor({ ...base, startShoeOut: false }, 100, 1)).toBe(false);
  });

  it('old data: a stored backCount: true starts each shoe out; startShoeOut: false overrides it', () => {
    expect(playConfigFor({ ...base, backCount: true }, 100, 1).startShoeOut).toBe(true);
    expect('startShoeOut' in playConfigFor({ ...base, backCount: false }, 100, 1)).toBe(false);
    expect('startShoeOut' in playConfigFor({ ...base, backCount: true, startShoeOut: false }, 100, 1)).toBe(false);
  });

  it('takes the session bankroll and seed it is given', () => {
    const cfg = playConfigFor(base, 137, 9);
    expect(cfg.bankrollStart).toBe(137);
    expect(cfg.seed).toBe(9);
  });

  it('B8: carries hotShoe only when it is on', () => {
    expect(playConfigFor({ ...base, hotShoe: true }, 100, 1).hotShoe).toBe(true);
    expect('hotShoe' in playConfigFor({ ...base, hotShoe: false }, 100, 1)).toBe(false);
    expect('hotShoe' in playConfigFor(base, 100, 1)).toBe(false);
  });
});
