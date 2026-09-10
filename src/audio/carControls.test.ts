import { describe, it, expect } from 'vitest';
import {
  carControlsBlockers,
  carControlsReady,
  describeCarControlsBlocker,
} from './carControls';

describe('carControlsBlockers', () => {
  it('reports nothing standing in the way when audio and the recorded voice are both on', () => {
    expect(carControlsBlockers({ enabled: true, useClips: true })).toEqual([]);
    expect(carControlsReady({ enabled: true, useClips: true })).toBe(true);
  });

  /**
   * The case that actually happened: audio on, live speech, and a driver
   * pressing every button on the wheel to no effect. Live TTS opens no media
   * element, so there is nothing for the car to talk to.
   */
  it('names live speech as a blocker when the recorded voice is off', () => {
    expect(carControlsBlockers({ enabled: true, useClips: false })).toEqual(['live-speech']);
    expect(carControlsReady({ enabled: true, useClips: false })).toBe(false);
  });

  it('names audio being off, and still names live speech under it', () => {
    expect(carControlsBlockers({ enabled: false, useClips: false })).toEqual([
      'audio-off',
      'live-speech',
    ]);
  });

  it('names only audio when the recorded voice is already on', () => {
    expect(carControlsBlockers({ enabled: false, useClips: true })).toEqual(['audio-off']);
  });
});

describe('describeCarControlsBlocker', () => {
  it('tells the operator which switch to move, by its on-screen name', () => {
    expect(describeCarControlsBlocker('audio-off')).toContain('Audio enabled');
    expect(describeCarControlsBlocker('live-speech')).toContain('Use recorded voice');
  });
});
