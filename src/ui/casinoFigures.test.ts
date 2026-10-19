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
  worstHeat,
} from './casinoFigures';
import { blankCasinoDraft, emptyCasinoLog, type CasinoLog, type CasinoSession, type HeatLevel } from '../store/casinoLog';

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
    expect(warnBadges({ game: { payout: '6:5' }, csm: true, midShoeEntry: 'no' })).toEqual(['6:5', 'CSM', 'No mid-shoe']);
    expect(warnBadges({ game: { payout: '3:2' }, csm: false, midShoeEntry: 'unknown' })).toEqual([]);
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
