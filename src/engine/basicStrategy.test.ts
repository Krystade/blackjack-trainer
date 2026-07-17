import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { HARD, SOFT, PAIRS, upIndex, chartLookup } from './basicStrategy';
import type { ChartAction } from './basicStrategy';

// Independent, compact-string transcription of the same chart, typed directly
// from the task-5 brief. Do NOT import/derive this from basicStrategy.ts --
// the whole point is two independent encodings that cross-check each other.
const HARD_EXPECT = [
  '4:H H H H H H H H H H', '5:H H H H H H H H H H', '6:H H H H H H H H H H',
  '7:H H H H H H H H H H', '8:H H H H H H H H H H',
  '9:H Dh Dh Dh Dh H H H H H',
  '10:Dh Dh Dh Dh Dh Dh Dh Dh H H',
  '11:Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',
  '12:H H S S S H H H H H',
  '13:S S S S S H H H H H', '14:S S S S S H H H H H',
  '15:S S S S S H H H Rh Rh',
  '16:S S S S S H H Rh Rh Rh',
  '17:S S S S S S S S S Rs',
  '18:S S S S S S S S S S', '19:S S S S S S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const SOFT_EXPECT = [
  '13:H H H Dh Dh H H H H H', '14:H H H Dh Dh H H H H H',
  '15:H H Dh Dh Dh H H H H H', '16:H H Dh Dh Dh H H H H H',
  '17:H Dh Dh Dh Dh H H H H H',
  '18:Ds Ds Ds Ds Ds S S H H H',
  '19:S S S S Ds S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const PAIRS_EXPECT = [
  '2:Ph Ph P P P P H H H H', '3:Ph Ph P P P P H H H H',
  '4:H H H Ph Ph H H H H H', '6:Ph P P P P H H H H H',
  '7:P P P P P P H H H H', '8:P P P P P P P P P Rp',
  '9:P P P P P S P P S S', 'A:P P P P P P P P P P',
];

// Column order for every row: dealer up 2 3 4 5 6 7 8 9 10 A
const UP_COLUMNS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function parseRow(entry: string): { key: string; actions: ChartAction[] } {
  const [key, rest] = entry.split(':');
  const actions = rest.trim().split(/\s+/) as ChartAction[];
  expect(actions.length).toBe(10);
  return { key, actions };
}

describe('HARD table matches independent transcription', () => {
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

describe('SOFT table matches independent transcription', () => {
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

describe('PAIRS table matches independent transcription', () => {
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

describe('upIndex', () => {
  it('2 -> 0', () => expect(upIndex('2')).toBe(0));
  it('3 -> 1', () => expect(upIndex('3')).toBe(1));
  it('4 -> 2', () => expect(upIndex('4')).toBe(2));
  it('5 -> 3', () => expect(upIndex('5')).toBe(3));
  it('6 -> 4', () => expect(upIndex('6')).toBe(4));
  it('7 -> 5', () => expect(upIndex('7')).toBe(5));
  it('8 -> 6', () => expect(upIndex('8')).toBe(6));
  it('9 -> 7', () => expect(upIndex('9')).toBe(7));
  it('10 -> 8', () => expect(upIndex('10')).toBe(8));
  it('J -> 8', () => expect(upIndex('J')).toBe(8));
  it('Q -> 8', () => expect(upIndex('Q')).toBe(8));
  it('K -> 8', () => expect(upIndex('K')).toBe(8));
  it('A -> 9', () => expect(upIndex('A')).toBe(9));
});

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('chartLookup behavioral cases', () => {
  it('(K,6) v 9 -> Rh', () => {
    expect(chartLookup(cards('K', '6'), '9')).toBe('Rh');
  });

  it('(A,7) v 2 -> Ds', () => {
    expect(chartLookup(cards('A', '7'), '2')).toBe('Ds');
  });

  it('(8,8) v A -> Rp', () => {
    expect(chartLookup(cards('8', '8'), 'A')).toBe('Rp');
  });

  it('(K,Q) v 6 -> S (ten-pair -> hard 20)', () => {
    expect(chartLookup(cards('K', 'Q'), '6')).toBe('S');
  });

  it('(5,5) v 6 -> Dh (hard-10 path, 5,5 not in PAIRS)', () => {
    expect(chartLookup(cards('5', '5'), '6')).toBe('Dh');
  });

  it('(A,4) v 4 -> Dh', () => {
    expect(chartLookup(cards('A', '4'), '4')).toBe('Dh');
  });

  it('(2,2) v 2 -> P (DEFAULT_RULES das:true resolves Ph -> P at assembly)', () => {
    expect(chartLookup(cards('2', '2'), '2')).toBe('P');
  });

  it('3-card (5,4,7)=16 v 10 -> Rh (chart is card-count agnostic)', () => {
    expect(chartLookup(cards('5', '4', '7'), '10')).toBe('Rh');
  });
});
