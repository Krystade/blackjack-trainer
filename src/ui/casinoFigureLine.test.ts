import { describe, it, expect } from 'vitest';
import { blankGame } from '../store/casinoLog';
import type { GameResult } from '../store/casinoGameStats';
import type { GameFigures, MethodFigures, RankRow } from './casinoRanking';
import { BADGE_TEXT, figureLine } from './casinoFigureLine';

/** A stored result with only what the line reads: its status and time. */
/** ms under capMs: still to be firmed up (an estimate); at or over it: partial. */
function result(status: GameResult['status'], ms = 1_000_000, capMs = 1): GameResult {
  return { status, ms, capMs } as unknown as GameResult;
}

function figures(over: Partial<GameFigures>): GameFigures {
  return { edge: 0.005, edgeCi: 0.0005, methods: null, best: null, evHour: -10, evHourCi: 1, n0Hours: null, partial: false, exitMinutes: 0, ...over };
}

const method = { method: { id: 'm', name: 'Ramp', entryTc: null, exitTc: null, flat: false } } as unknown as MethodFigures;

function row(f: GameFigures | null, state: RankRow['state'], over: Partial<RankRow> = {}): RankRow {
  return { game: { ...blankGame('g'), csm: f?.methods === null }, figures: f, state, input: { key: 'k' }, ...over } as unknown as RankRow;
}

describe('figureLine: a continuous shuffler', () => {
  it('review S1: a short run whose noise reads as a profit is "about break-even", with its interval, never a bare +$', () => {
    // edge -1.5% +/-2% at a $25 unit and 80 rounds/h: +$30 +/-$40/h.
    const f = figures({ edge: -0.015, edgeCi: 0.02, evHour: 30, evHourCi: 40, partial: true });
    const line = figureLine(row(f, { kind: 'current', result: result('partial') }));
    expect(line.text).toBe('No counting edge · about break-even ±$40/h');
    expect(line.text).not.toContain('+$');
    expect(line.sign).toBe(0);
    expect(line.edge).toBe('edge −1.50% ±2.00%');
    expect(line.badges).toEqual(['partial']);
    expect(line.extras).toEqual([]);
  });

  it('says what it loses once all of the interval is below zero, the interval kept until the run is done', () => {
    const partial = figureLine(row(figures({ evHour: -12.4, evHourCi: 3 }), { kind: 'current', result: result('partial') }));
    expect(partial.text).toBe('No counting edge · loses $12/h ±$3');
    expect(partial.sign).toBe(-1);
    const done = figureLine(row(figures({ evHour: -12.4, evHourCi: 0.4 }), { kind: 'current', result: result('done') }));
    expect(done.text).toBe('No counting edge · loses $12/h');
    expect(done.edge).toBe('edge 0.50%');
    expect(done.badges).toEqual([]);
  });

  it('shows a gain only when the whole interval is above zero, and says the rules favour the player', () => {
    const line = figureLine(row(figures({ edge: -0.01, evHour: 20, evHourCi: 5 }), { kind: 'current', result: result('done') }));
    expect(line.text).toBe('Rules favour the player · +$20 ±$5/h');
    expect(line.sign).toBe(1);
  });
});

describe('figureLine: a counted game', () => {
  // The best method's hours carry the row's figure (C25 reads them for the EV target).
  const counted = (over: Partial<GameFigures>) => {
    const f = figures({ methods: [method], n0Hours: 120, ...over });
    return { ...f, best: { ...method, hours: { evHour: f.evHour, evHourCi: f.evHourCi } } as unknown as MethodFigures };
  };

  it('carries the interval always, marks an estimate, and names no best method on one', () => {
    const r = row(counted({ evHour: 260, evHourCi: 300, edge: -0.0133, edgeCi: 0.02 }), { kind: 'current', result: result('partial', 10, 60_000) });
    const line = figureLine(r);
    expect(line.text).toBe('about break-even, +$260 ±$300/h');
    expect(line.badges).toEqual(['estimate']);
    expect(line.edge).toBe('edge −1.33% ±2.00%');
    expect(line.extras).toEqual(['N0 120 h']);
  });

  it('a firm win: the figure with its interval, the method named', () => {
    const line = figureLine(row(counted({ evHour: 41, evHourCi: 4 }), { kind: 'current', result: result('done') }));
    expect(line.text).toBe('+$41 ±$4/h');
    expect(line.sign).toBe(1);
    expect(line.badges).toEqual([]);
    expect(line.extras).toEqual(['N0 120 h', 'Play all']);
  });

  it('C25: a done run that misses the EV target at the exit minutes now in force is marked not firm', () => {
    // +$41 ±$6 is ±15%, wider than the ±10% target.
    const wide = figureLine(row(counted({ evHour: 41, evHourCi: 6, exitMinutes: 15 }), { kind: 'current', result: result('done') }));
    expect(wide.badges).toEqual(['notfirm']);
    expect(BADGE_TEXT.notfirm).toBe('Not firm');
    expect(wide.edge).toBe('edge 0.50%');
    const firm = figureLine(row(counted({ evHour: 41, evHourCi: 4 }), { kind: 'current', result: result('done') }));
    expect(firm.badges).toEqual([]);
  });

  it('a stale result is marked Updating, whatever its status', () => {
    const line = figureLine(row(counted({ evHour: 41, evHourCi: 6 }), { kind: 'stale', result: result('done') }));
    expect(line.badges).toEqual(['updating']);
    expect(line.extras).toEqual(['N0 120 h']);
  });

  it('no figures yet, a failed run, a variant', () => {
    expect(figureLine(row(null, { kind: 'none' })).text).toBe('Figures being worked out…');
    expect(figureLine(row(null, { kind: 'none' }), 'boom').text).toBe('Not worked out');
    expect(figureLine(row(null, { kind: 'none' }, { notModelled: true })).text).toBe('Not modelled: the simulator does not deal this game');
  });
});
