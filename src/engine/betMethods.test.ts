import { describe, it, expect } from 'vitest';
import { defaultMethods, describeMethod, duplicateOf, methodBadge, methodBet, methodSpread, methodsFor, normMethod, sameButLabel, type BetMethod } from './betMethods';
import { DEFAULT_SPREAD } from './game';

const m = (over: Partial<BetMethod>): BetMethod => ({ id: 'x', entryTc: null, exitTc: null, rampStartTc: null, ...over });

describe('methodSpread', () => {
  it('moves every row but the bottom so the first raise lands on the ramp start', () => {
    // DEFAULT_SPREAD first raises at +1; start at +3 shifts the rows by 2.
    const s = methodSpread(m({ rampStartTc: 3 }), DEFAULT_SPREAD);
    expect(s.map((r) => r.minTc)).toEqual([-99, 3, 4, 5, 6, 7]);
    expect(s.map((r) => r.units)).toEqual([1, 2, 4, 8, 10, 12]);
    expect(methodBet(s, 2).units).toBe(1);
    expect(methodBet(s, 3).units).toBe(2);
    expect(methodBet(s, 7).units).toBe(12);
  });

  it('no ramp start = the ramp as is; flat = one unit everywhere', () => {
    expect(methodSpread(m({}), DEFAULT_SPREAD)).toEqual(DEFAULT_SPREAD);
    expect(methodSpread(m({ flat: true }), DEFAULT_SPREAD)).toEqual([{ minTc: -99, units: 1 }]);
  });

  it('a ramp that never raises is left alone', () => {
    const flatRamp = [{ minTc: -99, units: 2 }];
    expect(methodSpread(m({ rampStartTc: 2 }), flatRamp)).toEqual(flatRamp);
  });

  it('keeps the x2 rows of the ramp', () => {
    const spread = [{ minTc: -99, units: 1 }, { minTc: 2, units: 2 }, { minTc: 4, units: 4, hands: 2 as const }];
    const s = methodSpread(m({ rampStartTc: 3 }), spread);
    expect(methodBet(s, 5)).toEqual({ units: 4, hands: 2 });
    expect(methodBet(s, 4)).toEqual({ units: 2, hands: 1 });
  });
});

describe('methodsFor', () => {
  it('drops a method that plays exactly like one already listed', () => {
    // The default profile exit is -2: "wong-profile" is "wong-2" again; and
    // DEFAULT_SPREAD raises at +1, so "start+1" is "ramp" again.
    const ids = methodsFor({ spread: DEFAULT_SPREAD }, [], 'allowed').map((x) => x.id);
    expect(ids).not.toContain('wong-profile');
    expect(ids).not.toContain('start+1');
    expect(ids).toContain('wong-2');
    expect(ids).toContain('start+2');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a back-count entering at 0 or below is play-from-the-shuffle again (every shoe starts at TC 0)', () => {
    // The default profile's own back-count is in at 0, out at -2: the same as wong out at -2.
    const ids = methodsFor({ spread: DEFAULT_SPREAD }, [], 'allowed').map((x) => x.id);
    expect(ids).not.toContain('bc-profile');
    const withEntry = methodsFor({ spread: DEFAULT_SPREAD, wongInTc: 3 }, [], 'allowed').map((x) => x.id);
    expect(withEntry).toContain('bc-profile');
  });

  it("keeps the profile's own exit when it is a different count", () => {
    const ids = methodsFor({ spread: DEFAULT_SPREAD, wongExitTc: -3 }, [], 'allowed').map((x) => x.id);
    expect(ids).toContain('wong-profile');
  });

  it('drops every back-count when mid-shoe entry is not allowed, keeps them when unknown', () => {
    const no = methodsFor({ spread: DEFAULT_SPREAD }, [m({ id: 'c', entryTc: 3, exitTc: 0 })], 'no');
    expect(no.some((x) => x.entryTc !== null)).toBe(false);
    const unknown = methodsFor({ spread: DEFAULT_SPREAD }, [m({ id: 'c', entryTc: 3, exitTc: 0 })], 'unknown');
    expect(unknown.map((x) => x.id)).toEqual(expect.arrayContaining(['bc+1-1', 'bc+2+0', 'c']));
  });

  it('adds custom methods after the defaults, unless they repeat one', () => {
    const out = methodsFor({ spread: DEFAULT_SPREAD }, [m({ id: 'dup', exitTc: -1 }), m({ id: 'new', exitTc: -4 })], 'allowed');
    expect(out.map((x) => x.id)).not.toContain('dup');
    expect(out[out.length - 1]!.id).toBe('new');
  });

  it('the default set covers the menu the owner asked for', () => {
    expect(defaultMethods({ spread: DEFAULT_SPREAD }).map((x) => x.id)).toEqual([
      'flat', 'ramp', 'wong-1', 'wong-2', 'wong-profile', 'start+1', 'start+2', 'bc+1-1', 'bc+2+0', 'bc-profile',
    ]);
  });
});

describe('review N4: duplicateOf', () => {
  const p = { spread: DEFAULT_SPREAD };
  it('names the default a custom method plays exactly like, and nothing for one of its own', () => {
    const same = m({ id: 'c1', exitTc: -1 });
    expect(duplicateOf(p, [same], same)?.id).toBe('wong-1');
    // Before it is saved, too.
    expect(duplicateOf(p, [], m({ id: 'new', exitTc: -1 }))?.id).toBe('wong-1');
    // A ramp start at the profile's own first raise is the plain ramp.
    expect(duplicateOf(p, [], m({ id: 'new', rampStartTc: 1 }))?.id).toBe('ramp');
    const own = m({ id: 'c2', exitTc: -4 });
    expect(duplicateOf(p, [own], own)).toBeNull();
  });

  it('a second custom method like the first is a duplicate of the first, not the other way round', () => {
    const first = m({ id: 'c1', exitTc: -4 });
    const second = m({ id: 'c2', exitTc: -4, label: 'Mine' });
    expect(duplicateOf(p, [first, second], first)).toBeNull();
    expect(duplicateOf(p, [first, second], second)?.id).toBe('c1');
  });
});

describe('normMethod', () => {
  it('clamps counts into range and refuses an entry at or below the exit', () => {
    expect(normMethod({ id: 'a', entryTc: 20, exitTc: -20, rampStartTc: 2.6 })).toEqual({ id: 'a', entryTc: 8, exitTc: -6, rampStartTc: 3 });
    expect(normMethod({ id: 'a', entryTc: 0, exitTc: 0, rampStartTc: null })).toBeNull();
    expect(normMethod({ entryTc: 1 })).toBeNull();
    expect(normMethod('x')).toBeNull();
  });

  it('a flat method has no ramp start; a label is trimmed', () => {
    expect(normMethod({ id: 'f', flat: true, rampStartTc: 3, label: '  Mine ' })).toEqual({
      id: 'f', flat: true, entryTc: null, exitTc: null, rampStartTc: null, label: 'Mine',
    });
  });
});

describe('names', () => {
  it('describes and badges each kind', () => {
    expect(describeMethod(m({ entryTc: 2, exitTc: 0 }))).toBe('Profile ramp, back-count in at +2, out at 0');
    expect(describeMethod(m({ exitTc: -1 }))).toBe('Profile ramp, wong out at −1');
    expect(describeMethod(m({ rampStartTc: 2 }))).toBe('Min bet to +2, then ramp, play all');
    expect(describeMethod(m({ flat: true }))).toBe('Flat min bet, play all');
    expect(methodBadge(m({ entryTc: 2, exitTc: 0 }))).toBe('Back-count');
    expect(methodBadge(m({ exitTc: -1 }))).toBe('Wong out');
    expect(methodBadge(m({ flat: true }))).toBe('Flat');
    expect(methodBadge(m({}))).toBe('Play all');
  });
});

describe('re-review R5: sameButLabel', () => {
  it('a new name alone is the same method; any other field changed is not', () => {
    const a = m({ id: 'c1', label: 'Mine', entryTc: 2, exitTc: -1, rampStartTc: 3 });
    expect(sameButLabel(a, { ...a, label: 'Renamed' })).toBe(true);
    expect(sameButLabel(a, { ...a, label: undefined })).toBe(true);
    for (const [field, v] of [
      ['id', 'c2'],
      ['entryTc', 3],
      ['entryTc', null],
      ['exitTc', -2],
      ['rampStartTc', 1],
      ['flat', true],
    ] as const) {
      expect(sameButLabel(a, { ...a, [field]: v }), field).toBe(false);
    }
  });

  it('compares fields, not text: key order and an absent flat do not matter', () => {
    const a: BetMethod = { id: 'c1', entryTc: null, exitTc: -1, rampStartTc: null };
    const reordered: BetMethod = { rampStartTc: null, exitTc: -1, id: 'c1', entryTc: null, flat: false };
    expect(sameButLabel(a, reordered)).toBe(true);
    expect(sameButLabel({ ...a, flat: true }, { ...reordered, flat: true, label: 'x' })).toBe(true);
  });
});
