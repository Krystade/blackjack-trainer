import { describe, it, expect } from 'vitest';
import type { Rank } from '../cards';
import { HARD, SOFT, PAIRS } from './d68_h17';
import type { ChartAction } from './types';

// Independent, compact-string transcription from docs/sources/verified-charts-transcription.md
// "## 4-8D H17" section, read directly from bj_4d_h17.gif 2026-09-14. Do NOT derive from
// d68_h17.ts.
//
// Why this file exists, added last: d68_h17 is the app's DEFAULT chart and was the only one of the
// six with no independent cell test. charts.test.ts imports it, but every assertion there is
// `expect(chart.HARD).toEqual(HARD_D68_H17)` — the module compared against itself, which verifies
// routing and cannot fail on a wrong cell. The other five charts had a test of this shape; this one
// did not, so the most-used chart in the app was the least-verified.
const HARD_EXPECT = [
  '4:H H H H H H H H H H',
  '5:H H H H H H H H H H',
  '6:H H H H H H H H H H',
  '7:H H H H H H H H H H',
  '8:H H H H H H H H H H',
  '9:H Dh Dh Dh Dh H H H H H',
  '10:Dh Dh Dh Dh Dh Dh Dh Dh H H',
  '11:Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',
  '12:H H S S S H H H H H',
  '13:S S S S S H H H H H',
  '14:S S S S S H H H H H',
  '15:S S S S S H H H Rh Rh',
  '16:S S S S S H H Rh Rh Rh',
  '17:S S S S S S S S S Rs',
  '18:S S S S S S S S S S',
  '19:S S S S S S S S S S',
  '20:S S S S S S S S S S',
  '21:S S S S S S S S S S',
];

const SOFT_EXPECT = [
  '13:H H H Dh Dh H H H H H',
  '14:H H H Dh Dh H H H H H',
  '15:H H Dh Dh Dh H H H H H',
  '16:H H Dh Dh Dh H H H H H',
  '17:H Dh Dh Dh Dh H H H H H',
  '18:Ds Ds Ds Ds Ds S S H H H',
  '19:S S S S Ds S S S S S',
  '20:S S S S S S S S S S',
  '21:S S S S S S S S S S',
];

const PAIRS_EXPECT = [
  '2:Ph Ph P P P P H H H H',
  '3:Ph Ph P P P P H H H H',
  '4:H H H Ph Ph H H H H H',
  '6:Ph P P P P H H H H H',
  '7:P P P P P P H H H H',
  '8:P P P P P P P P P Rp',
  '9:P P P P P S P P S S',
  'A:P P P P P P P P P P',
];

// Column order for every row: dealer up 2 3 4 5 6 7 8 9 10 A
const UP_COLUMNS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function parseRow(entry: string): { key: string; actions: ChartAction[] } {
  const [key, rest] = entry.split(':');
  const actions = rest.trim().split(/\s+/) as ChartAction[];
  expect(actions.length).toBe(10);
  return { key, actions };
}

describe('4-8D H17 HARD table matches independent transcription', () => {
  for (const entry of HARD_EXPECT) {
    const { key, actions } = parseRow(entry);
    const total = Number(key);
    for (let i = 0; i < UP_COLUMNS.length; i++) {
      it(`hard ${total} vs dealer ${UP_COLUMNS[i]} = ${actions[i]}`, () => {
        expect(HARD[total]?.[i]).toBe(actions[i]);
      });
    }
  }
});

describe('4-8D H17 SOFT table matches independent transcription', () => {
  for (const entry of SOFT_EXPECT) {
    const { key, actions } = parseRow(entry);
    const total = Number(key);
    for (let i = 0; i < UP_COLUMNS.length; i++) {
      it(`soft ${total} vs dealer ${UP_COLUMNS[i]} = ${actions[i]}`, () => {
        expect(SOFT[total]?.[i]).toBe(actions[i]);
      });
    }
  }
});

describe('4-8D H17 PAIRS table matches independent transcription', () => {
  for (const entry of PAIRS_EXPECT) {
    const { key, actions } = parseRow(entry);
    const rank = key as Rank;
    for (let i = 0; i < UP_COLUMNS.length; i++) {
      it(`pair ${rank},${rank} vs dealer ${UP_COLUMNS[i]} = ${actions[i]}`, () => {
        expect(PAIRS[rank]?.[i]).toBe(actions[i]);
      });
    }
  }
});

// The six cells where this chart must differ from d68_s17, each in the H17 direction. These are the
// deltas verified_charts-transcription.md records under "## 4-8D S17"; asserting them here means a
// copy-paste of the S17 module into this one cannot pass.
describe('4-8D H17 behavioral H17-signature spot-checks', () => {
  it('hard 11 vs A doubles (Dh, not H)', () => {
    expect(HARD[11]?.[9]).toBe('Dh');
  });

  it('hard 15 vs A surrenders (Rh, not H)', () => {
    expect(HARD[15]?.[9]).toBe('Rh');
  });

  it('hard 17 vs A surrenders (Rs, not S)', () => {
    expect(HARD[17]?.[9]).toBe('Rs');
  });

  it('soft 18 vs 2 doubles (Ds, not S)', () => {
    expect(SOFT[18]?.[0]).toBe('Ds');
  });

  it('soft 19 vs 6 doubles (Ds, not S)', () => {
    expect(SOFT[19]?.[4]).toBe('Ds');
  });

  it('pair 8,8 vs A surrenders (Rp, not P)', () => {
    expect(PAIRS['8']?.[9]).toBe('Rp');
  });
});
