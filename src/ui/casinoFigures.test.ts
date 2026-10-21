import { describe, it, expect } from 'vitest';
import {
  addMonths,
  agoText,
  bankrollNow,
  burnSuggestion,
  burnedText,
  daysBetween,
  elapsedText,
  exportIsDue,
  gameSummary,
  gameLogged,
  GAME_NOT_LOGGED,
  heatTone,
  lastVisitText,
  localDateKey,
  parseMoney,
  sessionHours,
  sessionNet,
  signedMoney,
  money,
  sortCasinos,
  standing,
  totals,
  warnBadges,
  casinoWarnBadges,
  labelledSummary,
  notesFirstLine,
  haversineMiles,
  distanceOf,
  milesText,
  evPerTripHour,
  distanceMinutes,
  ASSUMED_MPH,
  worstHeat,
} from './casinoFigures';
import { blankCasinoDraft, blankGame, emptyCasinoLog, type CasinoLog, type CasinoSession, type HeatLevel } from '../store/casinoLog';

const H = 3_600_000;
const D = 24 * H;
/** Local noon, so a local-date assertion cannot slip a day by timezone. */
const NOON = new Date(2026, 9, 18, 12, 0, 0).getTime();

function session(over: Partial<CasinoSession> & { start: string }): CasinoSession {
  return {
    id: Math.random().toString(36),
    casinoId: 'c1',
    end: null,
    buyIns: [],
    cashOut: null,
    heat: 'none',
    notes: '',
    createdAt: over.start,
    updatedAt: over.start,
    ...over,
  };
}

const iso = (t: number) => new Date(t).toISOString();

describe('per-session figures', () => {
  it('net is cash-out minus every buy-in, and null until cashed out', () => {
    expect(sessionNet({ buyIns: [500, 300], cashOut: 1200 })).toBe(400);
    expect(sessionNet({ buyIns: [500], cashOut: 0 })).toBe(-500);
    expect(sessionNet({ buyIns: [], cashOut: 50 })).toBe(50);
    expect(sessionNet({ buyIns: [500], cashOut: null })).toBeNull();
  });

  it('hours run to the end, or to now while running', () => {
    expect(sessionHours({ start: iso(NOON), end: iso(NOON + 2.5 * H) }, NOON + 99 * H)).toBe(2.5);
    expect(sessionHours({ start: iso(NOON), end: null }, NOON + 1.5 * H)).toBe(1.5);
  });
});

describe('totals, $/hour and bankroll', () => {
  const sessions = [
    session({ start: iso(NOON - 3 * D), end: iso(NOON - 3 * D + 2 * H), buyIns: [1000], cashOut: 1600 }),
    session({ start: iso(NOON - 2 * D), end: iso(NOON - 2 * D + 4 * H), buyIns: [1000, 500], cashOut: 900 }),
    // Running: no result yet, so not in the totals.
    session({ start: iso(NOON - H), buyIns: [800] }),
  ];

  it('adds finished sessions only', () => {
    const t = totals(sessions);
    expect(t.sessions).toBe(2);
    expect(t.net).toBe(0); // +600 and −600
    expect(t.hours).toBe(6);
    expect(t.perHour).toBe(0);
  });

  it('$/hour is net over hours, null with no hours', () => {
    expect(totals(sessions.slice(0, 1)).perHour).toBe(300);
    expect(totals([]).perHour).toBeNull();
  });

  it('bankroll is the starting bankroll plus all-time net, and unknown without a start', () => {
    const log: CasinoLog = { ...emptyCasinoLog(), sessions: sessions.slice(0, 1) };
    expect(bankrollNow(log)).toBeNull();
    expect(bankrollNow({ ...log, settings: { startingBankroll: 10_000, updatedAt: null } })).toBe(10_600);
  });
});

describe('dates and last visit', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    expect(daysBetween('2026-10-17', '2026-10-18')).toBe(1);
    expect(daysBetween('2026-09-25', '2026-10-18')).toBe(23);
    // Across the DST change in either hemisphere.
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('says how long ago in words', () => {
    expect(agoText(0)).toBe('today');
    expect(agoText(1)).toBe('yesterday');
    expect(agoText(23)).toBe('23 days ago');
    expect(agoText(120)).toBe('3 months ago');
    // Review N1: never "1 months ago".
    for (let d = 2; d < 3000; d++) expect(agoText(d)).not.toMatch(/^1 /);
    expect(agoText(60)).toBe('2 months ago');
    expect(agoText(800)).toBe('2 years ago');
  });

  it('last visit is the latest session, or never', () => {
    const s = [session({ start: iso(NOON - 23 * D) }), session({ start: iso(NOON - 40 * D) })];
    expect(lastVisitText(s, NOON)).toBe('23 days ago');
    expect(lastVisitText([], NOON)).toBe('never visited');
  });

  it('adds months clamped to the end of the month', () => {
    expect(addMonths('2026-10-18', 6)).toBe('2027-04-18');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
  });

  it('local date key is the local calendar date', () => {
    expect(localDateKey(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
  });
});

describe('burned casinos and the cool-off', () => {
  const today = localDateKey(NOON);
  it('a burn with a future date (or none) stays burned', () => {
    expect(standing({ status: 'burned', burnedUntil: '2027-01-01' }, NOON)).toEqual({ group: 'burned', coolOffOver: false });
    expect(standing({ status: 'burned', burnedUntil: null }, NOON)).toEqual({ group: 'burned', coolOffOver: false });
  });

  it('a burn whose date has come is playable again, flagged as cool-off over', () => {
    expect(standing({ status: 'burned', burnedUntil: today }, NOON)).toEqual({ group: 'playable', coolOffOver: true });
    expect(standing({ status: 'burned', burnedUntil: '2026-01-01' }, NOON)).toEqual({ group: 'playable', coolOffOver: true });
  });

  it('avoid and ok are what they say', () => {
    expect(standing({ status: 'avoid', burnedUntil: null }, NOON).group).toBe('avoid');
    expect(standing({ status: 'ok', burnedUntil: '2020-01-01' }, NOON)).toEqual({ group: 'playable', coolOffOver: false });
  });

  it('says until when, or indefinitely', () => {
    expect(burnedText({ burnedUntil: '2027-04-18' })).toBe('until 18 Apr 2027');
    expect(burnedText({ burnedUntil: null })).toBe('indefinitely');
  });

  it('sorts playable, then avoid, then burned; recent visits first within a group', () => {
    const mk = (id: string, name: string, status: 'ok' | 'avoid' | 'burned', burnedUntil: string | null = null) => ({
      ...blankCasinoDraft(name),
      id,
      status,
      burnedUntil,
      createdAt: iso(NOON),
      updatedAt: iso(NOON),
    });
    const log: CasinoLog = {
      ...emptyCasinoLog(),
      casinos: [
        mk('b', 'Burned', 'burned', '2099-01-01'),
        mk('a', 'Avoid', 'avoid'),
        mk('o', 'Old visit', 'ok'),
        mk('n', 'Never', 'ok'),
        mk('r', 'Recent visit', 'ok'),
        mk('x', 'Expired burn', 'burned', '2026-01-01'),
      ],
      sessions: [
        session({ casinoId: 'o', start: iso(NOON - 30 * D) }),
        session({ casinoId: 'r', start: iso(NOON - 2 * D) }),
        session({ casinoId: 'x', start: iso(NOON - 300 * D) }),
      ],
    };
    expect(sortCasinos(log, NOON).map((c) => c.name)).toEqual([
      'Recent visit',
      'Old visit',
      'Expired burn',
      'Never',
      'Avoid',
      'Burned',
    ]);
  });
});

describe('heat', () => {
  it('worst heat ever is the most serious level logged', () => {
    const at = (heat: HeatLevel) => session({ start: iso(NOON), heat });
    expect(worstHeat([at('attention'), at('back-off'), at('shuffle-up')])).toBe('back-off');
    expect(worstHeat([])).toBe('none');
  });

  it('a back-off suggests a six-month burn from the session day, a trespass an indefinite one', () => {
    expect(burnSuggestion('back-off', '2026-10-18')).toEqual({ until: '2027-04-18' });
    expect(burnSuggestion('trespass', '2026-10-18')).toEqual({ until: null });
    for (const h of ['none', 'attention', 'shuffle-up', 'flat-bet'] as const) expect(burnSuggestion(h, '2026-10-18')).toBeNull();
  });

  it('tones: milder heat warns, flat-bet and worse is bad', () => {
    expect(heatTone('none')).toBe('none');
    expect(heatTone('shuffle-up')).toBe('warn');
    expect(heatTone('flat-bet')).toBe('bad');
    expect(heatTone('trespass')).toBe('bad');
  });
});

describe('game summary and warnings', () => {
  it('writes the short form and leaves unknowns out', () => {
    expect(gameSummary({ decks: 6, s17: true, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1 })).toBe(
      '6D S17 DAS LS 3:2 · cut 1.0',
    );
    expect(gameSummary({ decks: 2, s17: false, das: false, surrender: false, payout: '6:5', cutDecksLeft: null })).toBe(
      '2D H17 NDAS NS 6:5',
    );
    expect(gameSummary({ decks: null, cutDecksLeft: 1.5 })).toBe('cut 1.5');
    expect(gameSummary({ decks: 2, cutDecksLeft: 0.75 })).toBe('2D · cut 0.75');
    expect(gameSummary({})).toBe('Game not logged');
  });

  it('warns about 6:5, a shuffler and no mid-shoe entry', () => {
    expect(warnBadges({ payout: '6:5', csm: true, midShoeEntry: 'no' })).toEqual(['6:5', 'CSM', 'No mid-shoe']);
    expect(warnBadges({ payout: '3:2', csm: false, midShoeEntry: 'unknown' })).toEqual([]);
  });

  it('a casino carries a warning only when every one of its games does', () => {
    const bad = { ...blankGame('a'), payout: '6:5' as const, csm: true };
    const good = { ...blankGame('b'), payout: '3:2' as const, csm: true };
    expect(casinoWarnBadges({ games: [bad] })).toEqual(['6:5', 'CSM']);
    expect(casinoWarnBadges({ games: [bad, good] })).toEqual(['CSM']);
  });

  it('labels a game and takes the first written line of the notes', () => {
    expect(labelledSummary({ ...blankGame('a'), label: 'DD pit 3', decks: 2 })).toBe('DD pit 3: 2D');
    expect(notesFirstLine('\n  \n  Ask for Maria  \nsecond')).toBe('Ask for Maria');
    expect(notesFirstLine('   ')).toBeNull();
  });
});

describe('distance and trip hours', () => {
  it('haversine: a degree of latitude, a known city pair, and zero', () => {
    // One degree of latitude on a sphere of radius R is R * pi / 180.
    expect(haversineMiles({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo((3958.8 * Math.PI) / 180, 6);
    // Along the equator a degree of longitude is the same arc.
    expect(haversineMiles({ lat: 0, lon: 10 }, { lat: 0, lon: 11 })).toBeCloseTo((3958.8 * Math.PI) / 180, 6);
    // Antipodes: half the circumference.
    expect(haversineMiles({ lat: 10, lon: 20 }, { lat: -10, lon: -160 })).toBeCloseTo(3958.8 * Math.PI, 3);
    expect(haversineMiles({ lat: 36.1, lon: -115.2 }, { lat: 36.1, lon: -115.2 })).toBe(0);
    // Symmetric.
    const a = { lat: 36.17, lon: -115.14 };
    const b = { lat: 34.05, lon: -118.24 };
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 9);
  });

  it('shows live miles when both points exist, else the drive time, else nothing', () => {
    const here = { lat: 0, lon: 0 };
    expect(distanceOf({ location: { lat: 0.05, lon: 0 }, driveMinutes: 30 }, here)?.text).toBe('3.5 mi');
    expect(distanceOf({ location: { lat: 0.05, lon: 0 }, driveMinutes: 30 }, null)?.text).toBe('30 min drive');
    expect(distanceOf({ location: null, driveMinutes: 75 }, here)?.text).toBe('1 h 15 min drive');
    expect(distanceOf({ location: null, driveMinutes: null }, here)).toBeNull();
    expect(milesText(37.4)).toBe('37 mi');
  });

  it('EV per trip hour spreads the session EV over the drive both ways', () => {
    // $40/h for 4 h = $160, over 4 h + 2 x 30 min = 5 h -> $32 per trip hour.
    expect(evPerTripHour(40, 4, 30)).toBeCloseTo(32, 9);
    // No drive: the session rate itself.
    expect(evPerTripHour(40, 4, 0)).toBe(40);
    expect(evPerTripHour(40, 4, null)).toBeNull();
    // Review N3: a loss is not shrunk toward zero by the drive (that would
    // rank a far losing game above a near one); it stays at its EV per hour.
    expect(evPerTripHour(-10, 2, 60)).toBe(-10);
    expect(evPerTripHour(-30, 4, 90)).toBeLessThan(evPerTripHour(-20, 4, 5)!);
  });

  it('the Distance sort puts live miles and drive minutes on one scale, at 40 mph', () => {
    expect(ASSUMED_MPH).toBe(40);
    expect(distanceMinutes({ kind: 'miles', miles: 20, text: '' })).toBeCloseTo(30, 12);
    expect(distanceMinutes({ kind: 'drive', minutes: 25, text: '' })).toBe(25);
  });
});

describe('formatting and parsing', () => {
  it('money uses a real minus and cents only when there are some', () => {
    expect(money(1250)).toBe('$1,250');
    expect(money(-12.5)).toBe('−$12.50');
    expect(signedMoney(450)).toBe('+$450');
    expect(signedMoney(-200)).toBe('−$200');
    expect(signedMoney(0)).toBe('$0');
  });

  it('elapsed clock is h:mm:ss', () => {
    expect(elapsedText(0)).toBe('0:00:00');
    expect(elapsedText(5 * 60_000 + 9_000)).toBe('0:05:09');
    expect(elapsedText(12 * H)).toBe('12:00:00');
  });

  it('parses money fields: blank is null, junk is NaN', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(' $1,200 ')).toBe(1200);
    expect(parseMoney('12.5')).toBe(12.5);
    expect(parseMoney('abc')).toBeNaN();
    expect(parseMoney('-5')).toBeNaN();
  });

  it('nudges an export after 30 days, or when never exported, but only with data', () => {
    const log = emptyCasinoLog();
    expect(exportIsDue(log, NOON, false)).toBe(false);
    expect(exportIsDue(log, NOON, true)).toBe(true);
    expect(exportIsDue({ ...log, lastExportAt: iso(NOON - 29 * D) }, NOON, true)).toBe(false);
    expect(exportIsDue({ ...log, lastExportAt: iso(NOON - 31 * D) }, NOON, true)).toBe(true);
  });
});

describe('Wave L merge: a game with nothing logged', () => {
  it('reads "Game not logged" and is not logged; one rule logged is', () => {
    const g = blankGame('g');
    expect(gameSummary(g)).toBe(GAME_NOT_LOGGED);
    expect(gameLogged(g)).toBe(false);
    expect(gameLogged({ ...g, decks: 6 })).toBe(true);
    expect(gameLogged({ ...g, s17: false })).toBe(true);
    expect(gameLogged({ ...g, cutDecksLeft: 1 })).toBe(true);
  });
});
