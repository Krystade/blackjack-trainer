import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { speak, chime, isSpeechSupported, listVoices } from './speech';

describe('speech wrapper — absence guards (no browser APIs in jsdom/node)', () => {
  it('speak() does not throw when speechSynthesis is unavailable', () => {
    expect(() => speak('hello')).not.toThrow();
  });
  it('chime() does not throw when AudioContext is unavailable', () => {
    expect(() => chime('good')).not.toThrow();
  });
  it('isSpeechSupported() returns false without speechSynthesis', () => {
    expect(isSpeechSupported()).toBe(false);
  });
  it('listVoices() returns [] without speechSynthesis', () => {
    expect(listVoices()).toEqual([]);
  });
});

describe('speech wrapper — e2e log mode', () => {
  beforeEach(() => {
    (globalThis as any).window = {
      location: { search: '?e2e=1' },
    };
    (globalThis as any).window.__speechLog = undefined;
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('records speak() text into window.__speechLog instead of speaking', () => {
    speak('Win, plus two');
    expect((globalThis as any).window.__speechLog).toEqual(['Win, plus two']);
  });
  it('records chimes in the same ordered log', () => {
    speak('Correct');
    chime('good');
    expect((globalThis as any).window.__speechLog).toEqual(['Correct', 'chime:good']);
  });
});
