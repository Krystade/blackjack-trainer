import { describe, it, expect } from 'vitest';
import {
  carControlsBlockers,
  carControlsReady,
  describeCarControlsBlocker,
} from './carControls';

describe('carControlsBlockers', () => {
  it('reports nothing standing in the way when audio is on', () => {
    expect(carControlsBlockers({ enabled: true })).toEqual([]);
    expect(carControlsReady({ enabled: true })).toBe(true);
  });

  it('names audio being off', () => {
    expect(carControlsBlockers({ enabled: false })).toEqual(['audio-off']);
    expect(carControlsReady({ enabled: false })).toBe(false);
  });
});

describe('describeCarControlsBlocker', () => {
  it('tells the operator which switch to move, by its on-screen name', () => {
    expect(describeCarControlsBlocker('audio-off')).toContain('Audio enabled');
  });
});
