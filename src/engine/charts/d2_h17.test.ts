import { describe, it, expect } from 'vitest';
import type { Rank } from '../cards';
import { HARD, SOFT, PAIRS } from './d2_h17';
import type { ChartAction } from './types';

// Independent, compact-string transcription from docs/sources/verified-charts-transcription.md § 2D H17
// Two independent encodings cross-check each other.
const HARD_EXPECT = [
  '4:H H H H H H H H H H', '5:H H H H H H H H H H', '6:H H H H H H H H H H',
  '7:H H H H H H H H H H', '8:H H H H H H H H H H',
  '9:Dh Dh Dh Dh Dh H H H H H',
  '10:Dh Dh Dh Dh Dh Dh Dh Dh H H',
  '11:Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',
  '12:H H S S S H H H H H',
  '13:S S S S S H H H H H', '14:S S S S S H H H H H',
  '15:S S S S S H H H Rh Rh',
  '16:S S S S S H H H Rh Rh',
  '17:S S S S S S S S S Rs',
  '18:S S S S S S S S S S', '19:S S S S S S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const SOFT_EXPECT = [
  '13:H H H Dh Dh H H H H H', '14:H H Dh Dh Dh H H H H H',
  '15:H H Dh Dh Dh H H H H H', '16:H H Dh Dh Dh H H H H H',
  '17:H Dh Dh Dh Dh H H H H H',
  '18:Ds Ds Ds Ds Ds S S H H H',
  '19:S S S S Ds S S S S S',
  '20:S S S S S S S S S S', '21:S S S S S S S S S S',
];
const PAIRS_EXPECT = [
  '2:Ph Ph P P P P H H H H', '3:Ph Ph P P P P H H H H',
  '4:H H H Ph Ph H H H H H', '6:P P P P P Ph H H H H',
  '7:P P P P P P Ph H H H', '8:P P P P P P P P P Rp',
  '9:P P P P P S P P S S', 'A:P P P P P P P P P P',
];

const UP_COLUMNS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function parseRow(entry: string): { key: string; actions: ChartAction[] } {
  const [key, rest] = entry.split(':');
  const actions = rest.trim().split(/\s+/) as ChartAction[];
  expect(actions.length).toBe(10);
  return { key, actions };
}

describe('2D H17 HARD table matches independent transcription', () => {
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

describe('2D H17 SOFT table matches independent transcription', () => {
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

describe('2D H17 PAIRS table matches independent transcription', () => {
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

describe('2D H17 spot assertions', () => {
  it('9v2 Dh (basic double)', () => {
    expect(HARD[9]?.[0]).toBe('Dh');
  });
  it('16v9 H (no surrender)', () => {
    expect(HARD[16]?.[7]).toBe('H');
  });
  it('A,3v4 Dh', () => {
    expect(SOFT[14]?.[2]).toBe('Dh');
  });
  it('6,6v2 P', () => {
    expect(PAIRS['6']?.[0]).toBe('P');
  });
  it('7,7v8 Ph', () => {
    expect(PAIRS['7']?.[6]).toBe('Ph');
  });
  it('8,8vA Rp (LEGEND DIFFERENCE)', () => {
    expect(PAIRS['8']?.[9]).toBe('Rp');
  });
});
